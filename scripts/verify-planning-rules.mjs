/**
 * The planning layer's rules, against the deployed project: trucks, service
 * times and the Holt forecast record. The existing collections are covered by
 * verify-rules.mjs, which this does not touch.
 *
 *   node scripts/verify-planning-rules.mjs
 *
 * Creates one temporary event; the cleanup command is printed at the end.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const config = {
  apiKey: 'AIzaSyB39hgA2EXQfh4On3Sbi47chIwo3kwAGlo',
  authDomain: 'crowdcontroldiwali.firebaseapp.com',
  projectId: 'crowdcontroldiwali',
  storageBucket: 'crowdcontroldiwali.firebasestorage.app',
  messagingSenderId: '415131672506',
  appId: '1:415131672506:web:e1981ff82cb94c0d208783',
}
const newId = () => crypto.randomUUID().replace(/-/g, '')

async function user(name) {
  const app = initializeApp(config, name)
  const cred = await signInAnonymously(getAuth(app))
  return { db: getFirestore(app), uid: cred.user.uid }
}

let passed = 0
let failed = 0
async function expect(label, shouldAllow, fn) {
  let allowed
  let err
  try {
    await fn()
    allowed = true
  } catch (e) {
    allowed = false
    err = e?.code ?? String(e)
  }
  const ok = allowed === shouldAllow
  ok ? passed++ : failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${shouldAllow ? 'ALLOW' : 'DENY '} ${label}${ok || allowed ? '' : `  (${err})`}`)
}

const admin = await user('admin')
const visitor = await user('visitor')
const eventId = newId()
console.log(`\ntemp event: ${eventId}\n`)

const b = writeBatch(admin.db)
b.set(doc(admin.db, 'events', eventId), { name: 'Planning rules test', date: '2026-10-17', venue: 'nowhere', createdAt: serverTimestamp() })
b.set(doc(admin.db, 'events', eventId, 'private', 'admin'), { secret: 'TEST-PLAN-0001', adminUids: [admin.uid] })
await b.commit()

console.log('event planning inputs')
await expect('admin sets planning fields on the event', true, () =>
  updateDoc(doc(admin.db, 'events', eventId), { 'planning.enabled': true, 'planning.orderShare': 0.6 }),
)
await expect('a volunteer cannot', false, () =>
  updateDoc(doc(visitor.db, 'events', eventId), { 'planning.enabled': false }),
)

console.log('trucks')
const truckId = newId()
await expect('admin adds a truck', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'trucks', truckId), { name: 'Dosa', order: 0 }),
)
await expect('a volunteer cannot', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'trucks', newId()), { name: 'X', order: 1 }),
)

console.log('service times')
const sample = (u, over = {}) => ({
  truckId,
  durationMs: 95_000,
  clientTs: Timestamp.now(),
  serverTs: serverTimestamp(),
  deviceId: u.uid,
  undone: false,
  ...over,
})
const sid = newId()
await expect('a volunteer logs a service time', true, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', sid), sample(visitor)),
)
await expect('backdated two hours (offline sync)', true, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { clientTs: Timestamp.fromMillis(Date.now() - 2 * 3600_000) })),
)
await expect('as someone else', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { deviceId: admin.uid })),
)
await expect('a non-integer duration', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { durationMs: 95.5 })),
)
await expect('under a second', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { durationMs: 500 })),
)
await expect('over thirty minutes', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { durationMs: 1_800_001 })),
)
await expect('an extra field', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', newId()), sample(visitor, { note: 'x' })),
)
await expect('another device cannot undo it', false, () =>
  updateDoc(doc(admin.db, 'events', eventId, 'serviceTimes', sid), { undone: true }),
)
await expect('the device that wrote it can', true, () =>
  updateDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', sid), { undone: true }),
)
await expect('but cannot change the duration', false, () =>
  updateDoc(doc(visitor.db, 'events', eventId, 'serviceTimes', sid), { durationMs: 1000 }),
)

console.log('Holt forecasts')
const holt = (over = {}) => ({
  zoneId: 'z',
  madeAt: serverTimestamp(),
  targetTime: Timestamp.fromMillis(Date.now() + 15 * 60_000),
  predictedOccupancy: 10,
  horizonMin: 15,
  actualOccupancy: null,
  resolvedAt: null,
  ...over,
})
await expect('admin records one', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'forecastsHolt', 'z__1'), holt()),
)
await expect('a volunteer cannot', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'forecastsHolt', 'z__2'), holt()),
)
await expect('scoring before the target time', false, () =>
  updateDoc(doc(admin.db, 'events', eventId, 'forecastsHolt', 'z__1'), { actualOccupancy: 5, resolvedAt: serverTimestamp() }),
)

console.log(`\n${passed} passed, ${failed} failed`)
console.log(`\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force`)
process.exit(failed === 0 ? 0 : 1)
