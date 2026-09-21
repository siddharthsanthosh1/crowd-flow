import {
  Timestamp,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { newId } from '../ids'
import { OUTSIDE } from '../../types'
import type { Checkpoint, Zone } from '../../types'
import type { Truck } from './types'

/**
 * The planning half of the demo simulator. Demo events only - runSimulation is
 * only offered on an event marked demo, and this runs from inside it.
 *
 * Adds three trucks (unless the event already has some), a dozen timed
 * customers at each in the half hour before the food rush, the food-court
 * zone, and an order share - so the Planning section has something to show.
 * The staffing ratio is left for the organizer: it is never invented.
 */
export const DEMO_TRUCKS = ['Chaat Corner', 'Dosa Express', 'Mithai & Chai']
/** Mean service seconds for each demo truck. Samples are clipped to 60-180 s. */
const DEMO_MEAN_SEC = [80, 110, 145]
export const DEMO_SAMPLES_PER_TRUCK = 12
export const DEMO_ORDER_SHARE = 0.6
/** Festival minutes the timing volunteer works, before the food peak. */
const TIMING_FROM_MIN = 48
const TIMING_TO_MIN = 78

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Service times in seconds for one truck: skewed around its mean, 60-180 s. */
export function demoServiceSeconds(truckIndex: number, n: number, seed = 99): number[] {
  const random = rng(seed + truckIndex * 7919)
  const mean = DEMO_MEAN_SEC[truckIndex % DEMO_MEAN_SEC.length]
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    // Sum of uniforms: roughly normal, then exponentiated for a right skew.
    const z = (random() + random() + random() - 1.5) * 2
    out.push(Math.round(Math.min(180, Math.max(60, mean * Math.exp(0.22 * z)))))
  }
  return out
}

export async function seedPlanningDemo({
  eventId,
  uid,
  foodZoneId,
  minuteToMs,
}: {
  eventId: string
  uid: string
  foodZoneId: string | null
  /** Festival minute to wall-clock ms, as the tap history uses. */
  minuteToMs: (m: number) => number
}): Promise<void> {
  const existing = await getDocs(collection(db, 'events', eventId, 'trucks'))
  const live = existing.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Truck)
    .filter((t) => !t.archived)
    .sort((a, b) => a.order - b.order)

  const batch = writeBatch(db)
  const trucks: { id: string }[] = live.slice(0, 3)
  for (let i = trucks.length; i < DEMO_TRUCKS.length; i++) {
    const id = newId()
    batch.set(doc(db, 'events', eventId, 'trucks', id), { name: DEMO_TRUCKS[i], order: live.length + i })
    trucks.push({ id })
  }

  const update: Record<string, unknown> = { 'planning.orderShare': DEMO_ORDER_SHARE }
  if (foodZoneId) update['planning.foodZoneId'] = foodZoneId
  batch.update(doc(db, 'events', eventId), update)

  const random = rng(4242)
  trucks.forEach((truck, i) => {
    for (const sec of demoServiceSeconds(i, DEMO_SAMPLES_PER_TRUCK)) {
      const m = TIMING_FROM_MIN + random() * (TIMING_TO_MIN - TIMING_FROM_MIN)
      batch.set(doc(collection(db, 'events', eventId, 'serviceTimes')), {
        truckId: truck.id,
        durationMs: sec * 1000,
        clientTs: Timestamp.fromMillis(minuteToMs(m)),
        serverTs: serverTimestamp(),
        deviceId: uid,
        undone: false,
      })
    }
  })
  await batch.commit()
}

/** The area behind the simulator's "food" path, found the same way the simulator finds it. */
export function demoFoodZone(zones: Zone[], checkpoints: Checkpoint[], foodPath: Checkpoint | null): string | null {
  if (!foodPath) return null
  const gateZones = new Set(
    checkpoints
      .filter((c) => c.fromZoneId === OUTSIDE || c.toZoneId === OUTSIDE)
      .map((c) => (c.fromZoneId === OUTSIDE ? c.toZoneId : c.fromZoneId)),
  )
  const far = gateZones.has(foodPath.fromZoneId) ? foodPath.toZoneId : foodPath.fromZoneId
  return zones.some((z) => z.id === far) ? far : null
}

/** Soft-delete the service times this browser wrote, alongside the taps. */
export async function clearPlanningDemo(eventId: string, uid: string): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'events', eventId, 'serviceTimes'), where('deviceId', '==', uid)),
  )
  const live = snap.docs.filter((d) => d.data().undone !== true)
  for (let i = 0; i < live.length; i += 450) {
    const batch = writeBatch(db)
    for (const d of live.slice(i, i + 450)) batch.update(d.ref, { undone: true })
    await batch.commit()
  }
  return live.length
}
