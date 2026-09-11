import {
  arrayUnion,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { newAdminSecret, newId } from './ids'
import type { Checkpoint, Zone } from '../types'

export type EventMeta = { name: string; date: string; venue: string }

/**
 * Create an event and its admin secret in one batch. The creator's anonymous
 * uid is recorded as the first admin, which is what bootstraps the whole
 * permission scheme - see firestore.rules.
 */
export async function createEvent(
  meta: EventMeta,
  uid: string,
): Promise<{ eventId: string; secret: string }> {
  const eventId = newId()
  const secret = newAdminSecret()

  const batch = writeBatch(db)
  batch.set(doc(db, 'events', eventId), { ...meta, createdAt: serverTimestamp() })
  batch.set(doc(db, 'events', eventId, 'private', 'admin'), {
    secret,
    adminUids: [uid],
  })
  await batch.commit()

  return { eventId, secret }
}

/**
 * Prove knowledge of the admin secret and record this device's uid as an admin.
 * Throws if the secret is wrong (the rules reject the write). Safe to call
 * repeatedly - an existing admin is allowed through on the first rule branch.
 */
export async function claimAdmin(
  eventId: string,
  secret: string,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, 'events', eventId, 'private', 'admin'), {
    adminUids: arrayUnion(uid),
    claimSecret: secret,
  })
}

export async function saveEventMeta(eventId: string, meta: EventMeta): Promise<void> {
  await updateDoc(doc(db, 'events', eventId), { ...meta })
}

export async function saveZone(eventId: string, zone: Zone): Promise<void> {
  const { id, ...rest } = zone
  await setDoc(doc(db, 'events', eventId, 'zones', id), rest, { merge: true })
}

export async function saveCheckpoint(eventId: string, cp: Checkpoint): Promise<void> {
  const { id, ...rest } = cp
  await setDoc(doc(db, 'events', eventId, 'checkpoints', id), rest, { merge: true })
}

/** Nothing is hard-deleted; removing means hiding from the UI and the maths. */
export async function archiveZone(eventId: string, zoneId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventId, 'zones', zoneId), { archived: true })
}

export async function archiveCheckpoint(eventId: string, cpId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventId, 'checkpoints', cpId), { archived: true })
}

export async function saveZoneOrder(eventId: string, zones: Zone[]): Promise<void> {
  const batch = writeBatch(db)
  zones.forEach((z, i) => {
    batch.update(doc(db, 'events', eventId, 'zones', z.id), { order: i })
  })
  await batch.commit()
}

export async function saveCheckpointOrder(
  eventId: string,
  checkpoints: Checkpoint[],
): Promise<void> {
  const batch = writeBatch(db)
  checkpoints.forEach((c, i) => {
    batch.update(doc(db, 'events', eventId, 'checkpoints', c.id), { order: i })
  })
  await batch.commit()
}

/**
 * Copy this event's layout into a new event with fresh ids and fresh checkpoint
 * tokens. This is how the Town reuses the setup next year: old QR cards stop
 * working, the layout survives.
 */
export async function duplicateEvent(
  meta: EventMeta,
  uid: string,
  zones: Zone[],
  checkpoints: Checkpoint[],
): Promise<{ eventId: string; secret: string }> {
  const eventId = newId()
  const secret = newAdminSecret()

  // Old zone id -> new zone id, so checkpoints keep pointing at the right zones.
  const zoneIdMap = new Map<string, string>()
  for (const z of zones) zoneIdMap.set(z.id, newId())
  const mapZone = (id: string) => zoneIdMap.get(id) ?? id // leaves OUTSIDE alone

  // Two commits, for the same reason as createEvent: the zone writes below are
  // authorised by a rules get() on private/admin, which must already exist.
  const bootstrap = writeBatch(db)
  bootstrap.set(doc(db, 'events', eventId), { ...meta, createdAt: serverTimestamp() })
  bootstrap.set(doc(db, 'events', eventId, 'private', 'admin'), {
    secret,
    adminUids: [uid],
  })
  await bootstrap.commit()

  const batch = writeBatch(db)
  zones.forEach((z, i) => {
    batch.set(doc(db, 'events', eventId, 'zones', mapZone(z.id)), {
      name: z.name,
      capacity: z.capacity,
      order: i,
    })
  })

  checkpoints.forEach((c, i) => {
    batch.set(doc(db, 'events', eventId, 'checkpoints', newId()), {
      name: c.name,
      fromZoneId: mapZone(c.fromZoneId),
      toZoneId: mapZone(c.toZoneId),
      token: newId(),
      order: i,
    })
  })

  await batch.commit()
  return { eventId, secret }
}

export async function acknowledgeFlag(eventId: string, flagId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventId, 'flags', flagId), { acknowledged: true })
}

export async function resetZone(
  eventId: string,
  zoneId: string,
  newCount: number,
  note?: string,
): Promise<void> {
  await setDoc(doc(db, 'events', eventId, 'resets', newId()), {
    zoneId,
    newCount,
    ts: serverTimestamp(),
    ...(note ? { note } : {}),
  })
}
