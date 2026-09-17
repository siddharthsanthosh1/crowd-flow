/**
 * End-to-end check of the demo simulator and the rebuilt dashboard, in a real
 * browser: create a demo event, shrink its capacities, run a quarter-size
 * simulation, and read the dashboard back.
 *
 *   npm run build && npx vite preview   then   node scripts/demo-check.mjs
 *
 * Shrinking capacities to a quarter alongside a quarter-size crowd is what
 * makes this cheap: every percentage on the dashboard, and so every alert,
 * comes out exactly as it does at full size, for a quarter of the writes.
 *
 * Creates one temporary event; the cleanup command is printed at the end.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const SHOTS = process.env.SHOT_DIR ?? './shots'
mkdirSync(SHOTS, { recursive: true })

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { width: 1280, height: 1000 }

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  —  ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
  // Clearing a few thousand taps keeps the page busy for a while.
  protocolTimeout: 600_000,
})

const admin = await browser.newPage()
await admin.setViewport(DESKTOP)
const adminErrors = []
admin.on('pageerror', (e) => adminErrors.push(String(e)))

console.log('\nsetting up a throwaway demo event')
await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' })
// Anonymous sign-in has to land before the page renders its controls.
await admin.waitForFunction(
  () => [...document.querySelectorAll('button')].some((x) => /create demo event/i.test(x.textContent)),
  { timeout: 30000 },
)
await admin.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) =>
    /create demo event/i.test(x.textContent),
  )
  b.click()
})
await admin.waitForFunction(() => /\/admin\/[0-9a-f]{32}$/.test(location.pathname), {
  timeout: 20000,
})
const eventId = admin.url().split('/').pop()
check('demo event created', !!eventId, eventId)

// Quarter capacities to match the quarter-size crowd.
await admin.waitForFunction(() => document.body.innerText.includes('Main Lawn'), { timeout: 20000 })
const capacities = await admin.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type=number]')].slice(0, 4)
  return inputs.map((el) => Math.round(Number(el.value) / 4))
})
for (let i = 0; i < capacities.length; i++) {
  const handle = (await admin.$$('input[type=number]'))[i]
  await handle.click({ clickCount: 3 })
  await handle.type(String(capacities[i]))
  await admin.evaluate((el) => el.blur(), handle)
  await sleep(250)
}
check('capacities scaled to match', capacities.join(',') === '625,200,300,150', capacities.join(','))

console.log('\nrunning a quarter-size simulation')
await admin.evaluate(() => {
  const select = [...document.querySelectorAll('select')].find((el) =>
    [...el.options].some((o) => /Quarter/.test(o.textContent)),
  )
  select.value = '0.25'
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(300)
const planned = await admin.evaluate(
  () => document.body.innerText.match(/About ([\d,]+) taps/)?.[1] ?? '?',
)
console.log(`  plan: ${planned} taps`)
await admin.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simulate').click()
})

// History lands in a handful of batches; then the live tail starts.
await admin.waitForFunction(
  () => /Playing the last 20 minutes live/.test(document.body.innerText),
  { timeout: 120000 },
)
check('history written, live tail started', true)

// Let enough of the finale land that the stage is visibly rushing.
await sleep(150_000)
const simText = await admin.evaluate(() => document.body.innerText)
check('simulator reported progress', /Playing the last 20 minutes|Trickle running/.test(simText))

async function read(path, name, viewport) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' })
  await page
    .waitForFunction(() => document.querySelectorAll('svg.recharts-surface').length > 0, {
      timeout: 40000,
    })
    .catch(() => {})
  await sleep(3000)
  const stats = await page.evaluate(() => ({
    text: document.body.innerText,
    charts: document.querySelectorAll('svg.recharts-surface').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    titles: [...document.querySelectorAll('[title]')].map((el) => el.getAttribute('title')),
    overflowing: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`),
  }))
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  const real = errors.filter((e) => !/favicon|manifest|sw\.js|apple-mobile/i.test(e))
  check(`${name}: no page errors`, real.length === 0, real.slice(0, 2).join(' | '))
  check(
    `${name}: no horizontal overflow`,
    stats.scrollWidth <= stats.innerWidth + 1,
    `${stats.scrollWidth} vs ${stats.innerWidth} ${stats.overflowing.join(', ')}`,
  )
  return { page, stats }
}

console.log('\nthe dashboard on a phone')
const phone = await browser.newPage()
await phone.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await phone.evaluate((id) => localStorage.setItem(`crowdflow:admin:${id}`, '1'), eventId)
await phone.close()

const dash = await read(`/dash/${eventId}`, 'dashboard-phone', PHONE)
const t = dash.stats.text

check('SIMULATED badge is present', /SIMULATED/.test(t))
check('the four summary tiles', /Attendance so far/.test(t) && /On site now/.test(t) && /Watch/.test(t) && /Forecast accuracy/.test(t))
check('attendance has a number', /Attendance so far\n[\d,]+/.test(t), t.match(/Attendance so far\n[^\n]*/)?.[0])
check('watch tile names a zone or says steady', /full in ~\d+ min|All zones steady/.test(t), t.match(/Watch\n[^\n]*\n[^\n]*/)?.[0]?.replace(/\n/g, ' '))
check('forecast tile waits for five scored', /of 5 scored/.test(t), t.match(/Forecast accuracy\n[^\n]*\n[^\n]*/)?.[0]?.replace(/\n/g, ' '))
check('alert banner fired', /⚠ (Stage Seating|Main Lawn|Food Court|Vendor Row)/.test(t), t.match(/⚠ [^\n]*/)?.[0])
check('rate is per minute, not per 10 min', /\/ min/.test(t) && !/\/ 10 min/.test(t))
check('confidence chip on the cards', /CONFIDENCE · \d+M|confidence · \d+m/i.test(t), t.match(/\w+ confidence · \d+m/i)?.[0])
check('silent feeder warning on a zone', /stopped reporting at/i.test(t), t.match(/⚠ [^\n]*stopped reporting[^\n]*/i)?.[0])
const order = (needle) => t.toUpperCase().indexOf(needle.toUpperCase())
check(
  'checkpoint health sits under the cards',
  order('Zones') >= 0 && order('Checkpoint health') > order('Zones') && order('Checkpoint health') < order('Arrivals and attendance'),
  `zones ${order('Zones')}, health ${order('Checkpoint health')}, chart ${order('Arrivals and attendance')}`,
)
check('everything else is behind More', /More/.test(t) && !/Operations log/.test(t) && !/Flow, last/.test(t))
check('the chart is collapsed on a phone', /arrivals and attendance/i.test(t) && dash.stats.charts <= 5, `${dash.stats.charts} charts`)
check('no unlock box in the page body', !/Enter the admin secret/.test(t))

const confidenceTip = dash.stats.titles.find((x) => /time since calibration/i.test(x ?? ''))
check('confidence explains itself on hover', !!confidenceTip, confidenceTip?.slice(0, 80))

const fullest = t.match(/(Main Lawn|Food Court|Stage Seating|Vendor Row)\n(\d+)%/g) ?? []
const pcts = fullest.map((m) => Number(m.match(/(\d+)%/)[1]))
check('zone cards are sorted fullest first', pcts.every((p, i) => i === 0 || pcts[i - 1] >= p), pcts.join(' ≥ '))

console.log('\nthe dashboard on a desktop')
const wide = await read(`/dash/${eventId}`, 'dashboard-desktop', DESKTOP)
check('the chart is open on a desktop', wide.stats.charts > dash.stats.charts, `${wide.stats.charts} vs ${dash.stats.charts}`)

console.log('\nthe checklist')
const list = await read(`/admin/${eventId}/checklist`, 'checklist', PHONE)
check('every item is listed', (list.stats.text.match(/Firebase is on the Blaze plan/) ?? []).length === 1)
check('progress is counted', /0 of 7 done/.test(list.stats.text))
await list.page.click('input[type=checkbox]')
await sleep(400)
await list.page.reload({ waitUntil: 'networkidle2' })
await sleep(1500)
check(
  'a tick survives a reload',
  /1 of 7 done/.test(await list.page.evaluate(() => document.body.innerText)),
)

console.log('\nvendor links on the admin page')
const adminText = await admin.evaluate(() => document.body.innerText)
check('a vendor link per zone', (adminText.match(/\/vendor\/[0-9a-f]{32}\//g) ?? []).length >= 4)

console.log('\nclearing the simulation')
admin.on('dialog', (d) => d.accept())
// Not awaited: the click opens a confirm(), which blocks the page until the
// dialog handler above accepts it, and an awaited evaluate would deadlock.
admin
  .evaluate(() => {
    ;[...document.querySelectorAll('button')].find((x) => /Clear simulation/.test(x.textContent)).click()
  })
  .catch(() => {})
let clearStatus = null
for (let i = 0; i < 40; i++) {
  await sleep(5000)
  clearStatus = await admin
    .evaluate(
      () =>
        document.body.innerText.match(
          /(Finding simulated taps[^\n]*|Clearing…[^\n]*|Cleared [^\n]*|Nothing to clear[^\n]*|Could not clear[^\n]*|Missing or insufficient[^\n]*|[^\n]*index[^\n]*)/,
        )?.[0] ?? null,
    )
    .catch((e) => `page unresponsive: ${e.message.slice(0, 60)}`)
  console.log(`    t+${(i + 1) * 5}s  ${clearStatus ?? '(no status yet)'}`)
  if (clearStatus && /^Cleared|^Nothing to clear/.test(clearStatus)) break
}
check('clear reported what it undid', /^Cleared/.test(clearStatus ?? ''), clearStatus ?? 'never reported')

const after = await read(`/dash/${eventId}`, 'dashboard-cleared', DESKTOP)
check('the dashboard is empty again', /Attendance so far\n0/.test(after.stats.text))
check('but still says SIMULATED', /SIMULATED/.test(after.stats.text))

check('admin page threw no errors', adminErrors.length === 0, adminErrors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\nscreenshots in ${SHOTS}`)
console.log(
  `\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force`,
)
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
