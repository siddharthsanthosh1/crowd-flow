/**
 * The Phase 1 acceptance test: three devices tapping at the same time, one of
 * them offline for a while and then reconnected. Counts must reconcile exactly.
 *
 *   node scripts/simulate-event.mjs [offlineSeconds]
 *
 * Occupancy is recomputed here independently of src/lib/occupancy.ts, so this
 * checks the real stored data rather than agreeing with itself.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
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

const OFFLINE_SECONDS = Number(process.argv[2] ?? 300)
const newId = () => crypto.randomUUID().replace(/-/g, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function client(name) {
  const app = initializeApp(config, name)
  const cred = await signInAnonymously(getAuth(app))
  return { name, db: getFirestore(app), uid: cred.user.uid }
}

const LAWN = newId()
const FOOD = newId()
const STAGE = newId()
const GATE = newId()
const PATH_FOOD = newId()
const PATH_STAGE = newId()

const admin = await client('sim-admin')
const eventId = newId()

const bootstrap = writeBatch(admin.db)
bootstrap.set(doc(admin.db, 'events', eventId), {
  name: 'Simulation',
  date: '2026-10-17',
  venue: 'Morrisville Community Park',
  createdAt: serverTimestamp(),
})
bootstrap.set(doc(admin.db, 'events', eventId, 'private', 'admin'), {
  secret: 'SIMU-LATI-ON01',
  adminUids: [admin.uid],
})
await bootstrap.commit()

const batch = writeBatch(admin.db)
;[
  [LAWN, 'Main Lawn', 2500],
  [FOOD, 'Food Court', 800],
  [STAGE, 'Stage Seating', 1200],
].forEach(([id, name, capacity], i) =>
  batch.set(doc(admin.db, 'events', eventId, 'zones', id), { name, capacity, order: i }),
)
;[
  [GATE, 'Gate A', 'OUTSIDE', LAWN],
  [PATH_FOOD, 'Path to Food Court', LAWN, FOOD],
  [PATH_STAGE, 'Stage Entrance', LAWN, STAGE],
].forEach(([id, name, from, to], i) =>
  batch.set(doc(admin.db, 'events', eventId, 'checkpoints', id), {
    name,
    fromZoneId: from,
    toZoneId: to,
    token: newId(),
    order: i,
  }),
)
await batch.commit()
console.log(`event ${eventId}\n`)

const phones = [
  { ...(await client('phone-a')), checkpointId: GATE },
  { ...(await client('phone-b')), checkpointId: PATH_FOOD },
  { ...(await client('phone-c')), checkpointId: PATH_STAGE },
]

// What we intend to tap. The store must end up holding exactly this.
const expected = new Map() // `${checkpointId}:${direction}` -> count
const record = (cp, dir) => {
  const k = `${cp}:${dir}`
  expected.set(k, (expected.get(k) ?? 0) + 1)
}

function tap(phone, direction) {
  record(phone.checkpointId, direction)
  // Not awaited, exactly as the app does it.
  setDoc(doc(collection(phone.db, 'events', eventId, 'taps')), {
    checkpointId: phone.checkpointId,
    direction,
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    deviceId: phone.uid,
    undone: false,
  }).catch((e) => {
    console.error('WRITE REJECTED', e.code)
    process.exitCode = 1
  })
}

async function tapBurst(phone, ins, outs) {
  for (let i = 0; i < ins; i++) {
    tap(phone, 'in')
    await sleep(15)
  }
  for (let i = 0; i < outs; i++) {
    tap(phone, 'out')
    await sleep(15)
  }
}

console.log('phase 1: all three phones online')
await Promise.all([
  tapBurst(phones[0], 120, 10),
  tapBurst(phones[1], 40, 5),
  tapBurst(phones[2], 30, 2),
])

console.log(`phase 2: phone-c goes offline for ${OFFLINE_SECONDS}s while all three keep tapping`)
await disableNetwork(phones[2].db)
await Promise.all([
  tapBurst(phones[0], 80, 6),
  tapBurst(phones[1], 25, 4),
  tapBurst(phones[2], 35, 3), // queued on the device
])
console.log('  phone-c taps are queued locally; waiting out the outage')
await sleep(OFFLINE_SECONDS * 1000)

console.log('phase 3: phone-c reconnects')
await enableNetwork(phones[2].db)

// Wait until an independent reader can see every tap.
const reader = await client('sim-reader')
const totalExpected = [...expected.values()].reduce((a, b) => a + b, 0)
let seen = 0
for (let attempt = 0; attempt < 60; attempt++) {
  await sleep(1000)
  const snap = await getDocs(collection(reader.db, 'events', eventId, 'taps'))
  seen = snap.size
  if (seen >= totalExpected) break
}

const snap = await getDocs(collection(reader.db, 'events', eventId, 'taps'))
const actual = new Map()
let missingServerTs = 0
snap.forEach((d) => {
  const t = d.data()
  const k = `${t.checkpointId}:${t.direction}`
  actual.set(k, (actual.get(k) ?? 0) + 1)
  if (!t.serverTs) missingServerTs++
})

console.log('\nper checkpoint and direction')
let ok = true
const names = { [GATE]: 'Gate A', [PATH_FOOD]: 'Path to Food', [PATH_STAGE]: 'Stage Entrance' }
for (const [k, want] of [...expected].sort()) {
  const got = actual.get(k) ?? 0
  const [cp, dir] = k.split(':')
  const good = got === want
  ok &&= good
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${names[cp].padEnd(16)} ${dir.padEnd(4)} expected ${want}, stored ${got}`)
}

// Independent occupancy check: in = toZone +1 / fromZone -1, out = reverse.
const cps = {
  [GATE]: { from: 'OUTSIDE', to: LAWN },
  [PATH_FOOD]: { from: LAWN, to: FOOD },
  [PATH_STAGE]: { from: LAWN, to: STAGE },
}
const occ = { [LAWN]: 0, [FOOD]: 0, [STAGE]: 0 }
snap.forEach((d) => {
  const t = d.data()
  if (t.undone) return
  const cp = cps[t.checkpointId]
  const entering = t.direction === 'in' ? cp.to : cp.from
  const leaving = t.direction === 'in' ? cp.from : cp.to
  if (entering !== 'OUTSIDE') occ[entering]++
  if (leaving !== 'OUTSIDE') occ[leaving]--
})

// Gate in/out is the only boundary with OUTSIDE, so site total must equal it.
const gateIn = expected.get(`${GATE}:in`) ?? 0
const gateOut = expected.get(`${GATE}:out`) ?? 0
const siteTotal = occ[LAWN] + occ[FOOD] + occ[STAGE]
const totalOk = siteTotal === gateIn - gateOut
ok &&= totalOk

console.log('\noccupancy')
console.log(`  Main Lawn ${occ[LAWN]}, Food Court ${occ[FOOD]}, Stage Seating ${occ[STAGE]}`)
console.log(
  `  ${totalOk ? 'ok  ' : 'FAIL'} people on site ${siteTotal} = gate in ${gateIn} - gate out ${gateOut}`,
)
console.log(`  ${missingServerTs === 0 ? 'ok  ' : 'FAIL'} every tap has a server timestamp (${missingServerTs} missing)`)
ok &&= missingServerTs === 0

console.log(`\n${seen}/${totalExpected} taps stored`)
console.log(ok && seen === totalExpected ? '\nPASS - counts reconcile exactly' : '\nFAIL')
console.log(
  `\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force\n`,
)
process.exit(ok && seen === totalExpected ? 0 : 1)
