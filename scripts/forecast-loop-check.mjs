/**
 * The forecast loop is the one part of the dashboard that writes data and then
 * grades itself, so it is verified by actually running it: hold the dashboard
 * open long enough for a forecast to be recorded, for its target time to pass,
 * and for it to be scored.
 *
 *   node scripts/forecast-loop-check.mjs <eventId> <secret> [minutes]
 */
import puppeteer from 'puppeteer-core'
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { collection, getDocs, getFirestore } from 'firebase/firestore'

const BASE = 'https://crowdcontroldiwali.web.app'
const [eventId, secret, minutesArg] = process.argv.slice(2)
const MINUTES = Number(minutesArg ?? 20)

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await page.goto(`${BASE}/dash/${eventId}`, { waitUntil: 'networkidle2' })
await page.evaluate((id, s) => localStorage.setItem(`crowdflow:secret:${id}`, s), eventId, secret)
await page.reload({ waitUntil: 'networkidle2' })
console.log(`dashboard open, holding for ${MINUTES} minutes…`)

for (let m = 1; m <= MINUTES; m++) {
  await new Promise((r) => setTimeout(r, 60_000))
  const shown = await page.evaluate(
    () => document.body.innerText.match(/Scored\n(\d+)/)?.[1] ?? '?',
  )
  console.log(`  ${String(m).padStart(2)} min · dashboard says scored: ${shown}`)
}

const app = initializeApp({
  apiKey: 'AIzaSyB39hgA2EXQfh4On3Sbi47chIwo3kwAGlo',
  authDomain: 'crowdcontroldiwali.firebaseapp.com',
  projectId: 'crowdcontroldiwali',
  storageBucket: 'crowdcontroldiwali.firebasestorage.app',
  messagingSenderId: '415131672506',
  appId: '1:415131672506:web:e1981ff82cb94c0d208783',
})
await signInAnonymously(getAuth(app))
const snap = await getDocs(collection(getFirestore(app), 'events', eventId, 'forecasts'))

const all = snap.docs.map((d) => d.data())
const scored = all.filter((f) => f.actualOccupancy !== null)
const ids = new Set(snap.docs.map((d) => d.id))

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

console.log('\nforecast loop')
check('forecasts were recorded', all.length > 0, `${all.length} total`)
check('document ids are deduplicated', ids.size === all.length, `${ids.size} unique`)
check('every forecast has a target 15 minutes out', all.every((f) => f.horizonMin === 15))
check('forecasts were scored once their moment passed', scored.length > 0, `${scored.length} scored`)
check(
  'scored forecasts carry a real number',
  scored.every((f) => typeof f.actualOccupancy === 'number' && f.actualOccupancy >= 0),
)
check(
  'unscored forecasts are all still in the future or inside the grace period',
  all
    .filter((f) => f.actualOccupancy === null)
    .every((f) => f.targetTime.toMillis() > Date.now() - 3 * 60_000),
)

if (scored.length > 0) {
  const mae =
    scored.reduce((sum, f) => sum + Math.abs(f.predictedOccupancy - f.actualOccupancy), 0) /
    scored.length
  console.log(`\n  mean absolute error over ${scored.length} scored forecasts: ${mae.toFixed(2)} people`)
}

await browser.close()
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
