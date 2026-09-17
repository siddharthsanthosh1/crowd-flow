/**
 * Checks the analytics pages render cleanly on a phone: charts present, nothing
 * overflowing sideways, no page errors.
 *
 *   npm i --no-save puppeteer-core && node scripts/phone-check.mjs <eventId> <secret> [zoneId]
 *
 * Checks the live site by default. To check a local build instead:
 *   npm run build && npx vite preview   then   BASE=http://localhost:4173 node scripts/phone-check.mjs ...
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE ?? 'https://crowdcontroldiwali.web.app'
const [eventId, secret] = process.argv.slice(2)
const SHOTS = process.env.SHOT_DIR ?? './shots'
mkdirSync(SHOTS, { recursive: true })

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})

async function open(path, name, { unlock = false } = {}) {
  const page = await browser.newPage()
  await page.setViewport(PHONE)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' })

  if (unlock) {
    await page.evaluate(
      (id, s) => {
        localStorage.setItem(`crowdflow:secret:${id}`, s)
      },
      eventId,
      secret,
    )
    await page.reload({ waitUntil: 'networkidle2' })
  }

  await page
    .waitForFunction(() => document.querySelectorAll('svg.recharts-surface').length > 0, {
      timeout: 30000,
    })
    .catch(() => {})

  // Let the responsive containers settle before measuring.
  await new Promise((r) => setTimeout(r, 2500))

  const stats = await page.evaluate(() => ({
    charts: document.querySelectorAll('svg.recharts-surface').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    text: document.body.innerText,
    // Anything poking out past the viewport horizontally.
    overflowing: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`),
  }))

  console.log(`\n${name}`)
  check('charts rendered', stats.charts > 0, `${stats.charts} charts`)
  check(
    'no horizontal overflow',
    stats.scrollWidth <= stats.innerWidth + 1,
    `scrollWidth ${stats.scrollWidth} vs ${stats.innerWidth}${
      stats.overflowing.length ? ` — ${stats.overflowing.join(', ')}` : ''
    }`,
  )
  const real = errors.filter((e) => !/favicon|manifest|sw\.js|apple-mobile/i.test(e))
  check('no page errors', real.length === 0, real.slice(0, 2).join(' | '))

  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  return { page, stats }
}

const dash = await open(`/dash/${eventId}`, 'dashboard', { unlock: true })
check('zone cards present', dash.stats.text.includes('Main Lawn'))
// The summary strip answers three questions in order: how many are here, what
// is about to be a problem, and whether the numbers can still be trusted.
check('attendance leads the strip', /attendance so far/i.test(dash.stats.text))
check('on site now', /on site now/i.test(dash.stats.text))
check('watch tile', /watch/i.test(dash.stats.text))
check('forecast accuracy tile', /forecast accuracy/i.test(dash.stats.text))
check('rate reads per minute', !/\/ 10 min/.test(dash.stats.text))
check('confidence on every card', /confidence · \d+ min/i.test(dash.stats.text))
check('checkpoint health is not buried', /checkpoint health/i.test(dash.stats.text))
// Flow, throughput and the operations log live behind the More drawer now, and
// the drawer does not mount them until it is opened.
// Case-sensitive on purpose: the closed drawer's own label says "flow,
// throughput, operations log", while the section headings render upper-cased.
check(
  'detail is behind More',
  !/OPERATIONS LOG/.test(dash.stats.text) && !/FLOW, LAST/.test(dash.stats.text),
)
check('no unlock box in the page body', !/enter the admin secret/i.test(dash.stats.text))

const report = await open(`/report/${eventId}`, 'report')
check('report headline stats', /total attendance/i.test(report.stats.text))
check('report arrival curve', /arrival curve/i.test(report.stats.text))
check('report forecast table', /forecast accuracy/i.test(report.stats.text))

if (process.argv[4]) {
  const vendor = await open(`/vendor/${eventId}/${process.argv[4]}`, 'vendor')
  check('vendor names its zone once', (vendor.stats.text.match(/Food Court/g) ?? []).length <= 1)
  check('vendor gives a plain-language status', /(Comfortable|Busy|Very busy)/.test(vendor.stats.text))
  check('vendor looks ahead', /In 15 minutes, expect around/.test(vendor.stats.text))
  check(
    'vendor shows no organizer controls',
    !/Reset|Unacknowledged|Operations log/.test(vendor.stats.text),
  )
  check('vendor still shows peak and dwell', /peak .* at /.test(vendor.stats.text))
}

await browser.close()
console.log(`\nscreenshots in ${SHOTS}`)
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
