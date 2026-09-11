/**
 * Creates an event with a realistic 90 minutes of back-dated taps, so the charts
 * have something to draw. Prints the event id and admin secret.
 *
 *   node scripts/seed-history.mjs
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  collection,
  doc,
  getFirestore,
  serverTimestamp,
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

const app = initializeApp(config)
const cred = await signInAnonymously(getAuth(app))
const db = getFirestore(app)
const uid = cred.user.uid

const eventId = newId()
const secret = 'SEED-DEMO-DATA'
const LAWN = newId(), FOOD = newId(), STAGE = newId(), VENDOR = newId()
const GATE = newId(), P_FOOD = newId(), P_STAGE = newId(), P_VENDOR = newId()

const bootstrap = writeBatch(db)
bootstrap.set(doc(db, 'events', eventId), {
  name: 'Rehearsal — Morrisville Diwali Festival',
  date: '2026-10-17',
  venue: 'Morrisville Community Park',
  createdAt: serverTimestamp(),
})
bootstrap.set(doc(db, 'events', eventId, 'private', 'admin'), { secret, adminUids: [uid] })
await bootstrap.commit()

const layout = writeBatch(db)
;[
  [LAWN, 'Main Lawn', 2500],
  [FOOD, 'Food Court', 800],
  [STAGE, 'Stage Seating', 1200],
  [VENDOR, 'Vendor Row', 600],
].forEach(([id, name, capacity], i) =>
  layout.set(doc(db, 'events', eventId, 'zones', id), { name, capacity, order: i }),
)
;[
  [GATE, 'Gate A — Main Entrance', 'OUTSIDE', LAWN],
  [P_FOOD, 'Path to Food Court', LAWN, FOOD],
  [P_STAGE, 'Stage Entrance', LAWN, STAGE],
  [P_VENDOR, 'Vendor Row Walkway', LAWN, VENDOR],
].forEach(([id, name, from, to], i) =>
  layout.set(doc(db, 'events', eventId, 'checkpoints', id), {
    name,
    fromZoneId: from,
    toZoneId: to,
    token: newId(),
    order: i,
  }),
)
await layout.commit()

// A crowd that builds over the first hour, peaks, then eases off.
const now = Date.now()
const MINUTES = 90
const pending = []
const push = (checkpointId, direction, atMs) =>
  pending.push({ checkpointId, direction, clientTs: Timestamp.fromMillis(atMs) })

for (let m = MINUTES; m >= 0; m--) {
  const at = now - m * 60_000
  const progress = (MINUTES - m) / MINUTES
  // Arrivals ramp up and taper: a rough bell.
  const intensity = Math.sin(Math.PI * Math.min(1, progress * 1.15))
  const arrivals = Math.round(2 + intensity * 12)
  const departures = Math.round(progress * progress * 6)

  for (let i = 0; i < arrivals; i++) push(GATE, 'in', at + Math.random() * 60_000)
  for (let i = 0; i < departures; i++) push(GATE, 'out', at + Math.random() * 60_000)

  // Internal movement. People wander to the food court and the stage and mostly
  // come back, so each path carries traffic in both directions with only a small
  // net flow - otherwise the lawn would drain faster than the gate fills it.
  const wander = (checkpointId, inRate, outRate) => {
    for (let i = 0; i < Math.round(arrivals * inRate); i++)
      push(checkpointId, 'in', at + Math.random() * 60_000)
    for (let i = 0; i < Math.round(arrivals * outRate); i++)
      push(checkpointId, 'out', at + Math.random() * 60_000)
  }
  wander(P_FOOD, 0.35, 0.29)
  wander(P_STAGE, 0.3, 0.24)
  wander(P_VENDOR, 0.16, 0.13)
}

for (let i = 0; i < pending.length; i += 400) {
  const batch = writeBatch(db)
  for (const tap of pending.slice(i, i + 400)) {
    batch.set(doc(collection(db, 'events', eventId, 'taps')), {
      ...tap,
      serverTs: serverTimestamp(),
      deviceId: uid,
      undone: false,
    })
  }
  await batch.commit()
}

console.log(JSON.stringify({ eventId, secret, taps: pending.length }, null, 2))
process.exit(0)
