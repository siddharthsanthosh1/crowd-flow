/**
 * Drives the deployed app in a real browser: creates the demo event, taps as a
 * volunteer, and checks the dashboard reflects it.
 *
 * Needs a local Chrome and puppeteer-core, which is not a project dependency:
 *   npm i -D puppeteer-core && node scripts/smoke-test.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'fs'

const BASE = process.argv[2] ?? 'https://crowdcontroldiwali.web.app'
const SHOTS = process.env.SHOT_DIR ?? './shots'
mkdirSync(SHOTS, { recursive: true })

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
let failures = 0

function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})

const page = await browser.newPage()
await page.setViewport({ width: 900, height: 1200 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

console.log('\nadmin: create the demo event')
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' })
await page.waitForSelector('button')
const buttons = await page.$$('button')
let demoButton = null
for (const b of buttons) {
  const t = await b.evaluate((el) => el.textContent)
  if (t?.includes('Create demo event')) demoButton = b
}
check('demo button is on the admin page', !!demoButton)
await demoButton.click()
await page.waitForFunction(() => location.pathname.startsWith('/admin/') , { timeout: 30000 })
const eventId = await page.evaluate(() => location.pathname.split('/')[2])
check('redirected to the new event', !!eventId, eventId)

await page.waitForSelector('input')
const zoneCount = await page.evaluate(() =>
  [...document.querySelectorAll('input')].filter((i) => i.type === 'number').length,
)
check('four zones were created', zoneCount === 4, `found ${zoneCount}`)
await page.screenshot({ path: `${SHOTS}/admin.png`, fullPage: true })

const secret = await page.evaluate((id) => localStorage.getItem(`crowdflow:secret:${id}`), eventId)
check('admin secret was stored on this device', !!secret, secret ?? '')

// Grab a volunteer link from the details panel.
const volunteerUrl = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].map((a) => a.href)
  return links.find((h) => h.includes('/count/'))
})
check('volunteer links are available', !!volunteerUrl)

console.log('\nprint: QR cards')
const printPage = await browser.newPage()
await printPage.setViewport({ width: 900, height: 1400 })
await printPage.goto(`${BASE}/print/${eventId}`, { waitUntil: 'networkidle2' })
await printPage.waitForSelector('img', { timeout: 20000 })
const qrCount = await printPage.evaluate(
  () => document.querySelectorAll('img[src^="data:image/png"]').length,
)
check('one QR card per checkpoint plus the dashboard', qrCount === 5, `found ${qrCount}`)
await printPage.screenshot({ path: `${SHOTS}/print.png` })

console.log('\nvolunteer: tap IN and OUT')
// A fresh, isolated storage context: this is a phone that has never opened the
// app, which is every volunteer on the day. Listeners must not be attached
// until anonymous sign-in has completed, or the screen hangs on "Loading...".
const freshDevice = await browser.createBrowserContext()
const phone = await freshDevice.newPage()
await phone.setViewport(PHONE)
phone.on('pageerror', (e) => errors.push(String(e)))
await phone.goto(volunteerUrl, { waitUntil: 'networkidle2' })
const loaded = await phone
  .waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim().startsWith('IN')),
    { timeout: 30000 },
  )
  .then(() => true)
  .catch(() => false)
check('a phone that has never opened the app reaches the buttons', loaded,
  loaded ? '' : await phone.evaluate(() => document.body.innerText.slice(0, 80)))
if (!loaded) {
  await browser.close()
  process.exit(1)
}

const btn = async (label) => {
  const handles = await phone.$$('button')
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent ?? '')
    if (t.trim().startsWith(label)) return h
  }
  return null
}

const geometry = await phone.evaluate(() => {
  const bs = [...document.querySelectorAll('button')]
  const inB = bs.find((b) => b.textContent?.trim().startsWith('IN'))
  const outB = bs.find((b) => b.textContent?.trim().startsWith('OUT'))
  return {
    inPct: (inB.getBoundingClientRect().height / innerHeight) * 100,
    outPct: (outB.getBoundingClientRect().height / innerHeight) * 100,
  }
})
check(
  'IN and OUT each fill at least 40% of the screen',
  geometry.inPct >= 40 && geometry.outPct >= 40,
  `IN ${geometry.inPct.toFixed(1)}%, OUT ${geometry.outPct.toFixed(1)}%`,
)

const inButton = await btn('IN')
for (let i = 0; i < 12; i++) await inButton.click()
const outButton = await btn('OUT')
for (let i = 0; i < 3; i++) await outButton.click()

await phone.waitForFunction(
  () => document.body.innerText.includes('15 taps in last 60s'),
  { timeout: 15000 },
).catch(() => {})
const tally = await phone.evaluate(() => document.body.innerText)
check('the 60-second tally counts every tap', tally.includes('15 taps in last 60s'),
  tally.match(/\d+ taps? in last 60s/)?.[0] ?? 'not shown')

await phone.waitForFunction(() => document.body.innerText.includes('Synced'), { timeout: 20000 })
  .catch(() => {})
const synced = await phone.evaluate(() => document.body.innerText)
check('the connection indicator settles on synced', synced.includes('Synced'),
  synced.match(/Synced|\d+ waiting/)?.[0] ?? 'not shown')
await phone.screenshot({ path: `${SHOTS}/volunteer.png` })

console.log('\nvolunteer: undo')
const undo = await btn('UNDO')
const undoEnabled = await undo.evaluate((el) => !el.disabled)
check('UNDO is offered right after a tap', undoEnabled)
await undo.click()
await phone.waitForFunction(
  () => document.body.innerText.includes('14 taps in last 60s'),
  { timeout: 15000 },
).catch(() => {})
const afterUndo = await phone.evaluate(() => document.body.innerText)
check('UNDO removes exactly one tap', afterUndo.includes('14 taps in last 60s'),
  afterUndo.match(/\d+ taps? in last 60s/)?.[0] ?? 'not shown')

console.log('\ndashboard: live counts')
const dash = await browser.newPage()
await dash.setViewport({ width: 900, height: 1000 })
dash.on('pageerror', (e) => errors.push(String(e)))
await dash.goto(`${BASE}/dash/${eventId}`, { waitUntil: 'networkidle2' })
await dash.waitForFunction(() => document.body.innerText.includes('Main Lawn'), { timeout: 30000 })
await dash.waitForFunction(
  () => /Main Lawn\n10\b/.test(document.body.innerText),
  { timeout: 20000 },
).catch(() => {})
const dashText = await dash.evaluate(() => document.body.innerText)
// 12 in, 3 out, then UNDO - which removes the most recent tap, an OUT.
check('Main Lawn shows 10 after 12 in, 3 out and one undo',
  /Main Lawn\n10\b/.test(dashText), dashText.match(/Main Lawn\n[^\n]*/)?.[0] ?? '')
check('the 10-minute trend is shown', /\+10 \/ 10 min/.test(dashText),
  dashText.match(/[▲▼■] [+-]?\d+ \/ 10 min/)?.[0] ?? 'not shown')
check('checkpoint health is reporting', /last tap \d+s ago/.test(dashText),
  dashText.match(/last tap [^\n]*/)?.[0] ?? 'not shown')
check('quiet checkpoints are called out', dashText.includes('no taps yet'))
await dash.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true })

const realErrors = errors.filter((e) => !/favicon|manifest|sw\.js/i.test(e))
check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\nscreenshots in ${SHOTS}`)
console.log(`demo event: ${eventId}`)
console.log(`admin secret: ${secret}`)
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
