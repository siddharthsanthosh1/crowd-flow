/**
 * Checks that the demo simulator's writes are actually permitted by the
 * deployed rules, against the deployed project. The simulator does three things
 * no other part of the app does: it writes taps in a batch with a backdated
 * clientTs, it marks an event as a demo, and it soft-deletes a few thousand
 * taps at once. Each is verified here, along with the two limits the README
 * promises: the 24-hour backdating bound, and that only the browser that wrote
 * a tap can clear it.
 *
 *   node scripts/verify-simulator.mjs
 *
 * Creates one temporary event. Delete it with the command printed at the end.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
const MINUTE = 60_000

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` - ${extra}` : ''}`)
}
async function allowed(name, fn) {
  try {
    await fn()
    check(name, true)
  } catch (e) {
    check(name, false, e.code ?? e.message)
  }
}
async function denied(name, fn) {
  try {
    await fn()
    check(name, false, 'the write was allowed')
  } catch (e) {
    check(name, e.code === 'permission-denied', e.code ?? e.message)
  }
}

async function client(name) {
  const app = initializeApp(config, name)
  const cred = await signInAnonymously(getAuth(app))
  return { db: getFirestore(app), uid: cred.user.uid }
}

const organizer = await client('sim-verify-organizer')
const other = await client('sim-verify-other')
const eventId = newId()
const CP = newId()
const ZONE = newId()

console.log(`\ntemporary event ${eventId}\n`)

const bootstrap = writeBatch(organizer.db)
bootstrap.set(doc(organizer.db, 'events', eventId), {
  name: 'Simulator rule check',
  date: '2026-10-17',
  venue: 'Morrisville Community Park',
  createdAt: serverTimestamp(),
})
bootstrap.set(doc(organizer.db, 'events', eventId, 'private', 'admin'), {
  secret: 'VERI-FYSI-M001',
  adminUids: [organizer.uid],
})
await bootstrap.commit()

const setup = writeBatch(organizer.db)
setup.set(doc(organizer.db, 'events', eventId, 'zones', ZONE), {
  name: 'Main Lawn',
  capacity: 2500,
  order: 0,
})
setup.set(doc(organizer.db, 'events', eventId, 'checkpoints', CP), {
  name: 'Gate A',
  fromZoneId: 'OUTSIDE',
  toZoneId: ZONE,
  token: newId(),
  order: 0,
})
await setup.commit()

const tap = (db, uid, agoMs) => ({
  ref: doc(collection(db, 'events', eventId, 'taps')),
  data: {
    checkpointId: CP,
    direction: 'in',
    clientTs: Timestamp.fromMillis(Date.now() - agoMs),
    serverTs: serverTimestamp(),
    deviceId: uid,
    undone: false,
  },
})

console.log('the simulator writes history in a batch, backdated')
await allowed('a batch of 40 taps backdated up to 160 minutes', async () => {
  const batch = writeBatch(organizer.db)
  for (let i = 0; i < 40; i++) {
    const { ref, data } = tap(organizer.db, organizer.uid, (160 - i * 4) * MINUTE)
    batch.set(ref, data)
  }
  await batch.commit()
})
await allowed('a tap backdated 23 hours, the edge of what the rules allow', async () => {
  const batch = writeBatch(organizer.db)
  const { ref, data } = tap(organizer.db, organizer.uid, 23 * 60 * MINUTE)
  batch.set(ref, data)
  await batch.commit()
})
await denied('a tap backdated 25 hours, past the bound', async () => {
  const batch = writeBatch(organizer.db)
  const { ref, data } = tap(organizer.db, organizer.uid, 25 * 60 * MINUTE)
  batch.set(ref, data)
  await batch.commit()
})
await denied('a tap claiming to come from another device', async () => {
  const batch = writeBatch(organizer.db)
  const { ref, data } = tap(organizer.db, other.uid, MINUTE)
  batch.set(ref, data)
  await batch.commit()
})

console.log('\nbackdated flags, so the operations log has a history')
await allowed('a flag backdated 90 minutes', async () => {
  const batch = writeBatch(organizer.db)
  batch.set(doc(collection(organizer.db, 'events', eventId, 'flags')), {
    checkpointId: CP,
    type: 'long_line',
    clientTs: Timestamp.fromMillis(Date.now() - 90 * MINUTE),
    serverTs: serverTimestamp(),
    acknowledged: false,
  })
  await batch.commit()
})

console.log('\nmarking the event as a demo, which is what shows the SIMULATED badge')
await allowed('the organizer sets demo: true', () =>
  updateDoc(doc(organizer.db, 'events', eventId), { demo: true }),
)
await denied('someone without the secret sets demo: true', () =>
  updateDoc(doc(other.db, 'events', eventId), { demo: true }),
)

console.log('\nclearing the simulation')
const mine = await getDocs(
  query(collection(organizer.db, 'events', eventId, 'taps'), where('deviceId', '==', organizer.uid)),
)
check('the clear query finds the taps this device wrote', mine.size === 41, `found ${mine.size}`)

await allowed('a batch marking 41 taps undone', async () => {
  const batch = writeBatch(organizer.db)
  mine.docs.forEach((d) => batch.update(d.ref, { undone: true }))
  await batch.commit()
})

await denied('a different browser tries to clear them', async () => {
  const batch = writeBatch(other.db)
  batch.update(doc(other.db, 'events', eventId, 'taps', mine.docs[0].id), { undone: true })
  await batch.commit()
})

console.log(`\n${pass} passed, ${fail} failed`)
console.log(
  `\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force\n`,
)
process.exit(fail === 0 ? 0 : 1)
