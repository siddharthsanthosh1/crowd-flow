/**
 * Checks firestore.rules against the deployed project using two separate
 * anonymous users. Creates a temporary event; delete it afterwards with:
 *   firebase firestore:delete --recursive events/<id> --project crowdcontroldiwali
 *
 * Run with: node scripts/verify-rules.mjs
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
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
  const auth = getAuth(app)
  const cred = await signInAnonymously(auth)
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
  if (ok) passed++
  else failed++
  const verb = shouldAllow ? 'ALLOW' : 'DENY '
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${verb} ${label}${ok || allowed ? '' : `  (${err})`}`,
  )
}

const minutes = (n) => Timestamp.fromMillis(Date.now() + n * 60_000)

const admin = await user('admin')
const other = await user('other')
// `other` claims admin part-way through, so anything that must be checked as a
// plain volunteer after that point uses this third user, which never claims.
const visitor = await user('visitor')

const eventId = newId()
const secret = 'TEST-SECR-ET01'
console.log(`\ntemp event: ${eventId}\n`)

// --- bootstrap -------------------------------------------------------------
const batch = writeBatch(admin.db)
batch.set(doc(admin.db, 'events', eventId), {
  name: 'Rules test',
  date: '2026-10-17',
  venue: 'nowhere',
  createdAt: serverTimestamp(),
})
batch.set(doc(admin.db, 'events', eventId, 'private', 'admin'), {
  secret,
  adminUids: [admin.uid],
})
await batch.commit()

const zoneId = newId()
await setDoc(doc(admin.db, 'events', eventId, 'zones', zoneId), {
  name: 'Lawn',
  capacity: 100,
  order: 0,
})
const cpId = newId()
await setDoc(doc(admin.db, 'events', eventId, 'checkpoints', cpId), {
  name: 'Gate A',
  fromZoneId: 'OUTSIDE',
  toZoneId: zoneId,
  token: newId(),
  order: 0,
})

const tap = (db, over = {}) => ({
  checkpointId: cpId,
  direction: 'in',
  clientTs: Timestamp.now(),
  serverTs: serverTimestamp(),
  deviceId: db === admin.db ? admin.uid : other.uid,
  undone: false,
  ...over,
})

console.log('taps')
const goodTapRef = doc(collection(other.db, 'events', eventId, 'taps'))
await expect('volunteer writes a well-formed tap', true, () =>
  setDoc(goodTapRef, tap(other.db)),
)
await expect('tap made 20 minutes ago offline, syncing now', true, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { clientTs: minutes(-20) })),
)
await expect('tap made 3 hours ago offline, syncing now', true, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { clientTs: minutes(-180) })),
)
await expect('tap dated 1 hour in the future', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { clientTs: minutes(60) })),
)
await expect('tap dated 2 days ago', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { clientTs: minutes(-2880) })),
)
await expect('tap with an invalid direction', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { direction: 'sideways' })),
)
await expect('tap claiming another device id', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { deviceId: admin.uid })),
)
await expect('tap created already undone', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), tap(other.db, { undone: true })),
)
await expect('tap with an extra field', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), { ...tap(other.db), note: 'hi' }),
)
await expect('tap with a client-set serverTs', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'taps')), { ...tap(other.db), serverTs: Timestamp.now() }),
)

console.log('\nundo')
await expect('same device undoes its own tap', true, () =>
  updateDoc(goodTapRef, { undone: true }),
)
await expect('a different device undoes that tap', false, () =>
  updateDoc(doc(admin.db, 'events', eventId, 'taps', goodTapRef.id), { undone: true }),
)
await expect('un-undoing a tap', false, () => updateDoc(goodTapRef, { undone: false }))
await expect('editing a tap direction', false, () =>
  updateDoc(goodTapRef, { direction: 'out' }),
)
await expect('hard-deleting a tap', false, () => deleteDoc(goodTapRef))

console.log('\nadmin secret')
await expect('reading the private admin doc', false, () =>
  getDoc(doc(other.db, 'events', eventId, 'private', 'admin')),
)
await expect('admin reads it either', false, () =>
  getDoc(doc(admin.db, 'events', eventId, 'private', 'admin')),
)
await expect('claiming admin with the wrong secret', false, () =>
  updateDoc(doc(other.db, 'events', eventId, 'private', 'admin'), {
    adminUids: arrayUnion(other.uid),
    claimSecret: 'WRON-GSEC-RET0',
  }),
)
await expect('escalating with arrayUnion and no secret at all', false, () =>
  updateDoc(doc(other.db, 'events', eventId, 'private', 'admin'), {
    adminUids: arrayUnion(other.uid),
  }),
)

console.log('\nconfig writes')
await expect('non-admin edits a zone', false, () =>
  setDoc(doc(other.db, 'events', eventId, 'zones', zoneId), { capacity: 99999 }, { merge: true }),
)
await expect('non-admin edits the event', false, () =>
  updateDoc(doc(other.db, 'events', eventId), { name: 'hacked' }),
)
await expect('non-admin writes a reset', false, () =>
  setDoc(doc(other.db, 'events', eventId, 'resets', newId()), {
    zoneId,
    newCount: 0,
    ts: serverTimestamp(),
  }),
)
await expect('admin edits a zone', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'zones', zoneId), { capacity: 250 }, { merge: true }),
)
await expect('admin writes a reset', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'resets', newId()), {
    zoneId,
    newCount: 0,
    ts: serverTimestamp(),
  }),
)

console.log('\nclaiming admin on a second device')
await expect('claiming with the correct secret', true, () =>
  updateDoc(doc(other.db, 'events', eventId, 'private', 'admin'), {
    adminUids: arrayUnion(other.uid),
    claimSecret: secret,
  }),
)
await expect('that device can now edit a zone', true, () =>
  setDoc(doc(other.db, 'events', eventId, 'zones', zoneId), { capacity: 300 }, { merge: true }),
)

console.log('\nflags')
await expect('volunteer raises a flag', true, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'flags')), {
    checkpointId: cpId,
    type: 'long_line',
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    acknowledged: false,
  }),
)
await expect('flag with an invalid type', false, () =>
  setDoc(doc(collection(other.db, 'events', eventId, 'flags')), {
    checkpointId: cpId,
    type: 'aliens',
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    acknowledged: false,
  }),
)

console.log('\nforecasts')
const soon = () => Timestamp.fromMillis(Date.now() + 15_000)
const forecast = (over = {}) => ({
  zoneId,
  madeAt: serverTimestamp(),
  targetTime: soon(),
  predictedOccupancy: 120,
  horizonMin: 1,
  actualOccupancy: null,
  resolvedAt: null,
  ...over,
})

await expect('a volunteer records a forecast', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'forecasts', newId()), forecast()),
)
await expect('a forecast that already knows the answer', false, () =>
  setDoc(doc(admin.db, 'events', eventId, 'forecasts', newId()), forecast({ actualOccupancy: 100 })),
)
await expect('a forecast aimed at the past', false, () =>
  setDoc(doc(admin.db, 'events', eventId, 'forecasts', newId()), forecast({
    targetTime: Timestamp.fromMillis(Date.now() - 60_000),
  })),
)
await expect('a forecast aimed two hours out', false, () =>
  setDoc(doc(admin.db, 'events', eventId, 'forecasts', newId()), forecast({
    targetTime: Timestamp.fromMillis(Date.now() + 2 * 3600_000),
  })),
)

const forecastRef = doc(admin.db, 'events', eventId, 'forecasts', newId())
await expect('the organizer records a forecast', true, () => setDoc(forecastRef, forecast()))
await expect('scoring it before the moment it describes', false, () =>
  updateDoc(forecastRef, { actualOccupancy: 100, resolvedAt: serverTimestamp() }),
)
await expect('rewriting what was predicted', false, () =>
  updateDoc(forecastRef, { predictedOccupancy: 1 }),
)

console.log('  waiting for the forecast target time to pass…')
await new Promise((r) => setTimeout(r, 18_000))

await expect('a volunteer scores it', false, () =>
  updateDoc(doc(visitor.db, 'events', eventId, 'forecasts', forecastRef.id), {
    actualOccupancy: 100,
    resolvedAt: serverTimestamp(),
  }),
)
await expect('the organizer scores it once the moment has passed', true, () =>
  updateDoc(forecastRef, { actualOccupancy: 100, resolvedAt: serverTimestamp() }),
)
await expect('scoring it a second time', false, () =>
  updateDoc(forecastRef, { actualOccupancy: 7, resolvedAt: serverTimestamp() }),
)

console.log('\nactions and site map')
await expect('a volunteer writes a suggested action', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'actions', newId()), {
    zoneId,
    thresholdPct: 85,
    text: 'x',
    order: 0,
  }),
)
await expect('the organizer writes a suggested action', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'actions', newId()), {
    zoneId,
    thresholdPct: 85,
    text: 'Open the overflow area',
    order: 0,
  }),
)
await expect('a volunteer replaces the site map', false, () =>
  setDoc(doc(visitor.db, 'events', eventId, 'map', 'image'), {
    dataUrl: 'data:image/jpeg;base64,AAAA',
    updatedAt: serverTimestamp(),
  }),
)
await expect('the organizer uploads the site map', true, () =>
  setDoc(doc(admin.db, 'events', eventId, 'map', 'image'), {
    dataUrl: 'data:image/jpeg;base64,AAAA',
    updatedAt: serverTimestamp(),
  }),
)
await expect('anyone with the event id can read the site map', true, () =>
  getDoc(doc(visitor.db, 'events', eventId, 'map', 'image')),
)

console.log('\nbootstrap ordering')
// Zone writes are authorised by a rules get() on private/admin. Inside a single
// batch that document does not exist yet, so the batch is denied - which is why
// createEvent, createDemoEvent and duplicateEvent all commit in two steps.
await expect('creating an event and its first zone in one batch', false, () => {
  const id = newId()
  const b = writeBatch(other.db)
  b.set(doc(other.db, 'events', id), {
    name: 'x',
    date: '2026-10-17',
    venue: 'x',
    createdAt: serverTimestamp(),
  })
  b.set(doc(other.db, 'events', id, 'private', 'admin'), {
    secret: 'AAAA-BBBB-CCCC',
    adminUids: [other.uid],
  })
  b.set(doc(other.db, 'events', id, 'zones', newId()), { name: 'z', capacity: 1, order: 0 })
  return b.commit()
})

console.log('\nindexes')
await expect("the volunteer screen's own-taps query is indexed", true, () =>
  getDocs(
    query(
      collection(other.db, 'events', eventId, 'taps'),
      where('deviceId', '==', other.uid),
      orderBy('clientTs', 'desc'),
      limit(100),
    ),
  ),
)

console.log(`\n${passed} passed, ${failed} failed`)
console.log(
  `\nclean up:\n  firebase firestore:delete --recursive events/${eventId} --project crowdcontroldiwali --force\n`,
)
process.exit(failed === 0 ? 0 : 1)
