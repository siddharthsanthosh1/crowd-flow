/**
 * End-to-end check of the planning layer in a real browser, on one simulated
 * evening:
 *
 *   1. Flag OFF: the dashboard and report show nothing new, and - when
 *      COMPARE_BASE points at a build of `demo-ready` - read exactly the same
 *      as that build does for the same data.
 *   2. Flag ON (the admin switch): band, consistency checks, both forecasters,
 *      the Planning section with the what-if table, the replay scrubber, and the
 *      service-timer screen logging a customer.
 *   3. The ?planning=1 / ?planning=0 overrides, then the switch back off.
 *
 *   BASE=<url> [COMPARE_BASE=<demo-ready url>] node scripts/planning-check.mjs
 *
 * Creates one temporary event; the cleanup command is printed at the end.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const COMPARE_BASE = process.env.COMPARE_BASE ?? null
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
  protocolTimeout: 600_000,
})

const admin = await browser.newPage()
await admin.setViewport(DESKTOP)
const adminErrors = []
admin.on('pageerror', (e) => adminErrors.push(String(e)))
admin.on('dialog', (d) => d.accept())

const clickButton = (page, re) =>
  page.evaluate((src) => {
    const re = new RegExp(src, 'i')
    const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent.trim()))
    if (!b) return false
    b.click()
    return true
  }, re.source)

console.log(`\nsetting up a throwaway demo event on ${BASE}`)
await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' })
await admin.waitForFunction(
  () => [...document.querySelectorAll('button')].some((x) => /create demo event/i.test(x.textContent)),
  { polling: 500, timeout: 30000 },
)
await clickButton(admin, /create demo event/)
await admin.waitForFunction(() => /\/admin\/[0-9a-f]{32}$/.test(location.pathname), { polling: 500, timeout: 20000 })
const eventId = admin.url().split('/').pop()
check('demo event created', !!eventId, eventId)

await admin.waitForFunction(() => document.body.innerText.includes('Main Lawn'), { polling: 500, timeout: 20000 })
const capacities = await admin.evaluate(() =>
  [...document.querySelectorAll('input[type=number]')].slice(0, 4).map((el) => Math.round(Number(el.value) / 4)),
)
for (let i = 0; i < capacities.length; i++) {
  const handle = (await admin.$$('input[type=number]'))[i]
  await handle.click({ clickCount: 3 })
  await handle.type(String(capacities[i]))
  await admin.evaluate((el) => el.blur(), handle)
  await sleep(250)
}
check('planning switch is off on a new event', await admin.evaluate(() => {
  const box = [...document.querySelectorAll('section')].find((s) => /Planning features/.test(s.innerText))?.querySelector('input[type=checkbox]')
  return box ? !box.checked : false
}))

console.log('\nrunning a quarter-size simulation')
await admin.evaluate(() => {
  const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => /Quarter/.test(o.textContent)))
  select.value = '0.25'
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(300)
await admin.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simulate').click()
})
await admin.waitForFunction(() => /Playing the last 20 minutes live/.test(document.body.innerText), { polling: 500, timeout: 120000 })
check('history written, live tail started', true)
await admin.waitForFunction(() => /Trickle running/.test(document.body.innerText), { polling: 500, timeout: 300000 })
// Freeze the data so two builds can be compared on exactly the same log.
await clickButton(admin, /^Stop$/)
await sleep(4000)
check('simulation stopped, data frozen', true)

async function read(base, path, name, viewport, { fresh = false, wait = 'svg.recharts-surface' } = {}) {
  // A fresh incognito context has no admin unlock, so two origins compare fairly.
  const page = fresh ? await (await browser.createBrowserContext()).newPage() : await browser.newPage()
  await page.setViewport(viewport)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { polling: 500, timeout: 40000 }, wait).catch(() => {})
  await sleep(3000)
  const stats = await page.evaluate(() => ({
    text: document.body.innerText,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  if (name) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  const real = errors.filter((e) => !/favicon|manifest|sw\.js|apple-mobile/i.test(e))
  check(`${name ?? path}: no page errors`, real.length === 0, real.slice(0, 2).join(' | '))
  check(`${name ?? path}: no horizontal overflow`, stats.scrollWidth <= stats.innerWidth + 1, `${stats.scrollWidth} vs ${stats.innerWidth}`)
  return { page, text: stats.text }
}

// The dashboard's clock-driven parts ("12 min", "5:42 pm") move between two
// reads a few seconds apart; nothing else may differ.
const normalise = (t) => t.replace(/\d+/g, '#')

console.log('\nflag OFF')
const offDash = await read(BASE, `/dash/${eventId}`, 'planning-off-dashboard', PHONE)
check('no ± band', !/±/.test(offDash.text))
check('no consistency checks', !/Consistency checks/i.test(offDash.text))
check('no forecaster comparison', !/Forecasters compared/i.test(offDash.text))
check('the usual tiles are there', /Attendance so far\n[\d,]+\n/.test(offDash.text), offDash.text.match(/Attendance so far\n[^\n]*/)?.[0])
const offReport = await read(BASE, `/report/${eventId}`, 'planning-off-report', DESKTOP)
check('report has no Planning section', !/\nPlanning\n/.test(offReport.text) && !/Food trucks: what if/i.test(offReport.text))
check('report has no replay', !/\nREPLAY\n|\nReplay\n/.test(offReport.text))
const offOverride = await read(BASE, `/report/${eventId}?planning=0`, null, DESKTOP)
check('?planning=0 is the same as off', offOverride.text === offReport.text)

if (COMPARE_BASE) {
  console.log(`\nflag OFF compared with demo-ready at ${COMPARE_BASE}`)
  const newReport = await read(BASE, `/report/${eventId}`, null, DESKTOP, { fresh: true })
  const oldReport = await read(COMPARE_BASE, `/report/${eventId}`, 'demo-ready-report', DESKTOP, { fresh: true })
  check('report text identical to demo-ready', oldReport.text === newReport.text,
    oldReport.text === newReport.text ? '' : firstDiff(oldReport.text, newReport.text))
  const oldDash = await read(COMPARE_BASE, `/dash/${eventId}`, 'demo-ready-dashboard', PHONE, { fresh: true })
  const newDash = await read(BASE, `/dash/${eventId}`, 'planning-off-dashboard-fresh', PHONE, { fresh: true })
  check('dashboard text identical to demo-ready (clock digits aside)', normalise(oldDash.text) === normalise(newDash.text),
    normalise(oldDash.text) === normalise(newDash.text) ? '' : firstDiff(normalise(oldDash.text), normalise(newDash.text)))
}

console.log('\nswitching planning ON from the admin page')
await admin.bringToFront()
await admin.evaluate(() => {
  const box = [...document.querySelectorAll('section')].find((s) => /Planning features/.test(s.innerText)).querySelector('input[type=checkbox]')
  box.click()
})
await admin.waitForFunction(() => /Organizer inputs/.test(document.body.innerText), { polling: 500, timeout: 20000 })
check('switch on shows the inputs', true)
const planningText = await admin.evaluate(() => [...document.querySelectorAll('section')].find((s) => /Planning features/.test(s.innerText)).innerText)
check('simulator filled the order share', /Share of food-court visitors/.test(planningText))
check('three trucks with 12 timed each', (planningText.match(/12 timed · \d+s avg/g) ?? []).length === 3, (planningText.match(/\d+ timed[^\n]*/g) ?? []).join(' | '))

// The staffing ratio has no default; type one in as an organizer would.
const ratioInput = await admin.evaluateHandle(() =>
  [...document.querySelectorAll('label')].find((l) => /People on site per staff member/.test(l.innerText)).querySelector('input'),
)
await ratioInput.click({ clickCount: 3 })
await ratioInput.type('40')
await admin.evaluate((el) => el.blur(), ratioInput)
await sleep(800)

await clickButton(admin, /Create the service-timer card/)
await admin.waitForFunction(() => /\/service\/[0-9a-f]{32}\/[0-9a-f]{32}/.test(document.body.innerText), { polling: 500, timeout: 20000 })
const serviceLink = await admin.evaluate(() => document.body.innerText.match(/https?:\/\/[^\s]+\/service\/[0-9a-f]{32}\/[0-9a-f]{32}/)[0])
check('service-timer card created', true, serviceLink)

console.log('\nthe service-timer screen')
const svc = await browser.newPage()
await svc.setViewport(PHONE)
const svcErrors = []
svc.on('pageerror', (e) => svcErrors.push(String(e)))
await svc.goto(serviceLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle2' })
await svc.waitForFunction(() => /Which truck are you timing/.test(document.body.innerText), { polling: 500, timeout: 30000 })
await svc.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Chaat Corner/.test(b.innerText)).click())
await svc.waitForFunction(() => /START/.test(document.body.innerText), { polling: 500, timeout: 10000 })
check('truck picked, START showing', /12 timed · mean \d+:\d\d/.test(await svc.evaluate(() => document.body.innerText)))
await clickButton(svc, /^START/)
await sleep(1600)
check('START became DONE', /DONE/.test(await svc.evaluate(() => document.body.innerText)))
await clickButton(svc, /^DONE/)
await svc.waitForFunction(() => /13 timed/.test(document.body.innerText), { polling: 500, timeout: 15000 }).catch(() => {})
const svcText = await svc.evaluate(() => document.body.innerText)
check('one more customer logged', /13 timed/.test(svcText), svcText.split('\n').slice(0, 2).join(' | '))
await svc.screenshot({ path: `${SHOTS}/service-timer.png` })
await clickButton(svc, /UNDO LAST/)
await svc.waitForFunction(() => /12 timed/.test(document.body.innerText), { polling: 500, timeout: 15000 }).catch(() => {})
check('undo takes it back off', /12 timed/.test(await svc.evaluate(() => document.body.innerText)))
check('service screen threw no errors', svcErrors.length === 0, svcErrors.slice(0, 2).join(' | '))
const badToken = await browser.newPage()
await badToken.goto(`${BASE}/service/${eventId}/nottherighttoken`, { waitUntil: 'networkidle2' })
await badToken.waitForFunction(() => /not recognised/.test(document.body.innerText), { polling: 500, timeout: 20000 }).catch(() => {})
check('a wrong token is refused', /not recognised/.test(await badToken.evaluate(() => document.body.innerText)))

console.log('\nflag ON')
const onDash = await read(BASE, `/dash/${eventId}`, 'planning-on-dashboard', PHONE)
const band = onDash.text.match(/Attendance so far\n([\d,]+ ± \d+)/)?.[1]
check('attendance tile shows a band', !!band, band)
check('zone cards show a band', (onDash.text.match(/\n\d[\d,]*\n± \d+/g) ?? []).length >= 4, `${(onDash.text.match(/± \d+/g) ?? []).length} bands`)
check('consistency checks section', /Consistency checks/i.test(onDash.text))
check('both forecasters on the dashboard', /Straight line \(primary\)/i.test(onDash.text) && /Holt, damped trend/i.test(onDash.text))
check('confidence chip kept', /confidence · \d+ min/i.test(onDash.text))
await read(BASE, `/dash/${eventId}`, 'planning-on-dashboard-desktop', DESKTOP)

const onReport = await read(BASE, `/report/${eventId}`, 'planning-on-report', DESKTOP)
const r = onReport.text
const at = (needle) => r.indexOf(needle)
check('Planning section present', at('\nPlanning\n') > 0)
check('sections in the brief\'s order',
  [ '1. COUNTED ATTENDANCE', '2. ARRIVALS AND STAFFING', '3. FOOD TRUCKS: WHAT IF', '4. CONSISTENCY CHECKS', '5. ASSUMPTIONS' ]
    .map((h) => r.toUpperCase().indexOf(h)).every((v, i, a) => v > 0 && (i === 0 || a[i - 1] < v)))
check('attendance with band', /Total attendance\n[\d,]+ ± \d+/.test(r), r.match(/Total attendance\n[^\n]*/g)?.at(-1))
check('staffing table from the typed ratio', /1 staff member per 40 people/.test(r) && /peak/.test(r))
check('what-if table at the demo order share', /60% of arrivals order/.test(r) && /\(actual\)/.test(r))
check('best case labelled', /Best case/i.test(r))
check('what-if spans actual - 1 to actual + 2', /\n2\t/.test(r) && /\n5\t/.test(r), '')
check('per-truck service table', /Chaat Corner\t12\t\d+ s/.test(r), r.match(/Chaat Corner[^\n]*/)?.[0])
check('assumptions box lists inputs and defaults', /YOUR INPUT/.test(r) && /DEFAULT/.test(r) && /People on site per staff member\t40/.test(r))
check('no dollar figures', !/\$/.test(r))
check('replay scrubber present', /Replay/i.test(r) && (await onReport.page.$('input[type=range]')) !== null)
const before = await onReport.page.evaluate(() => document.body.innerText.match(/Attendance so far\n([^\n]*)/)?.[1])
await onReport.page.evaluate(() => {
  const s = document.querySelector('input[type=range]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(s, String(Number(s.min) + (Number(s.max) - Number(s.min)) * 0.3))
  s.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(800)
const after = await onReport.page.evaluate(() => document.body.innerText.match(/Attendance so far\n([^\n]*)/)?.[1])
check('dragging the scrubber changes the numbers', before !== after, `${before} → ${after}`)
await onReport.page.screenshot({ path: `${SHOTS}/planning-on-report-scrubbed.png`, fullPage: true })

console.log('\noverrides and switching back off')
await admin.bringToFront()
const override0 = await read(BASE, `/dash/${eventId}?planning=0`, null, PHONE)
check('?planning=0 hides it while the switch is on', !/±/.test(override0.text) && !/Consistency checks/i.test(override0.text))
await admin.evaluate(() => {
  const box = [...document.querySelectorAll('section')].find((s) => /Planning features/.test(s.innerText)).querySelector('input[type=checkbox]')
  box.click()
})
await sleep(1500)
const backOff = await read(BASE, `/dash/${eventId}`, null, PHONE)
check('switch off: dashboard back to normal', !/±/.test(backOff.text) && !/Consistency checks/i.test(backOff.text))
const override1 = await read(BASE, `/report/${eventId}?planning=1`, null, DESKTOP)
check('?planning=1 shows it while the switch is off', /Food trucks: what if/i.test(override1.text))

console.log('\nclearing the simulation')
await admin.bringToFront()
admin.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Clear simulation/.test(x.textContent)).click()).catch(() => {})
let clearStatus = null
for (let i = 0; i < 40; i++) {
  await sleep(5000)
  clearStatus = await admin.evaluate(() => document.body.innerText.match(/(Cleared [^\n]*|Nothing to clear[^\n]*|Could not clear[^\n]*)/)?.[0] ?? null).catch(() => null)
  if (clearStatus) break
}
check('clear reported what it undid', /^Cleared/.test(clearStatus ?? ''), clearStatus ?? 'never reported')
check('admin page threw no errors', adminErrors.length === 0, adminErrors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\nscreenshots in ${SHOTS}`)
console.log(`\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force`)
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

function firstDiff(a, b) {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return `first difference at ${i}: "${a.slice(Math.max(0, i - 30), i + 40).replace(/\n/g, '⏎')}" vs "${b.slice(Math.max(0, i - 30), i + 40).replace(/\n/g, '⏎')}"`
}
