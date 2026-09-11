import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { newAdminSecret, newId } from './ids'
import { OUTSIDE } from '../types'

/**
 * A plausible Morrisville Community Park layout, so Town staff can be handed a
 * phone and start tapping without any setup.
 */
const DEMO_ZONES = [
  { key: 'lawn', name: 'Main Lawn', capacity: 2500 },
  { key: 'food', name: 'Food Court', capacity: 800 },
  { key: 'stage', name: 'Stage Seating', capacity: 1200 },
  { key: 'vendor', name: 'Vendor Row', capacity: 600 },
]

const DEMO_CHECKPOINTS = [
  { name: 'Gate A — Main Entrance', from: OUTSIDE, to: 'lawn' },
  { name: 'Path to Food Court', from: 'lawn', to: 'food' },
  { name: 'Stage Entrance', from: 'lawn', to: 'stage' },
  { name: 'Vendor Row Walkway', from: 'lawn', to: 'vendor' },
]

export async function createDemoEvent(
  uid: string,
): Promise<{ eventId: string; secret: string; name: string }> {
  const eventId = newId()
  const secret = newAdminSecret()
  const name = 'Demo — Morrisville Diwali Festival'

  const zoneIds = new Map(DEMO_ZONES.map((z) => [z.key, newId()]))
  const zoneId = (key: string) => (key === OUTSIDE ? OUTSIDE : zoneIds.get(key)!)

  const batch = writeBatch(db)
  batch.set(doc(db, 'events', eventId), {
    name,
    date: '2026-10-17',
    venue: 'Morrisville Community Park',
    createdAt: serverTimestamp(),
  })
  batch.set(doc(db, 'events', eventId, 'private', 'admin'), {
    secret,
    adminUids: [uid],
  })

  DEMO_ZONES.forEach((z, i) => {
    batch.set(doc(db, 'events', eventId, 'zones', zoneId(z.key)), {
      name: z.name,
      capacity: z.capacity,
      order: i,
    })
  })

  DEMO_CHECKPOINTS.forEach((c, i) => {
    batch.set(doc(db, 'events', eventId, 'checkpoints', newId()), {
      name: c.name,
      fromZoneId: zoneId(c.from),
      toZoneId: zoneId(c.to),
      token: newId(),
      order: i,
    })
  })

  await batch.commit()
  return { eventId, secret, name }
}
