import type { Checkpoint, Reset, Tap, Zone } from '../types'
import { OUTSIDE } from '../types'

/**
 * The effect of one tap on zone occupancy.
 *
 *   direction "in"  = a person moved  fromZone -> toZone
 *   direction "out" = a person moved  toZone   -> fromZone
 *
 * OUTSIDE is not a real zone, so a movement across it changes only the real side.
 */
export function tapDeltas(
  cp: Checkpoint,
  tap: Tap,
): { zoneId: string; delta: number }[] {
  const entering = tap.direction === 'in' ? cp.toZoneId : cp.fromZoneId
  const leaving = tap.direction === 'in' ? cp.fromZoneId : cp.toZoneId
  const out: { zoneId: string; delta: number }[] = []
  if (entering !== OUTSIDE) out.push({ zoneId: entering, delta: 1 })
  if (leaving !== OUTSIDE) out.push({ zoneId: leaving, delta: -1 })
  return out
}

/** Resets written a moment ago have no server timestamp yet; treat them as "now". */
function resetMs(r: Reset): number {
  return r.ts ? r.ts.toMillis() : Date.now()
}

/**
 * The baseline each zone counts up from: the most recent reset at or before `at`,
 * or 0 from the beginning of time if the zone has never been reset.
 */
function baselines(
  zones: Zone[],
  resets: Reset[],
  at: number,
): Map<string, { count: number; since: number }> {
  const base = new Map<string, { count: number; since: number }>()
  for (const z of zones) base.set(z.id, { count: 0, since: 0 })
  for (const r of resets) {
    const ms = resetMs(r)
    if (ms > at) continue
    const current = base.get(r.zoneId)
    if (current && ms >= current.since) {
      base.set(r.zoneId, { count: r.newCount, since: ms })
    }
  }
  return base
}

/**
 * Occupancy of every zone at time `at`, derived entirely from the tap log:
 * the zone's most recent reset, plus every non-undone tap since that reset.
 */
export function computeOccupancy(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  at: number = Date.now(),
): Map<string, number> {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const base = baselines(zones, resets, at)

  const counts = new Map<string, number>()
  for (const z of zones) counts.set(z.id, base.get(z.id)?.count ?? 0)

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const ms = tap.clientTs.toMillis()
    if (ms > at) continue
    for (const { zoneId, delta } of tapDeltas(cp, tap)) {
      const b = base.get(zoneId)
      if (!b) continue // tap references a zone that no longer exists
      if (ms <= b.since) continue // superseded by a reset
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + delta)
    }
  }

  // A zone cannot hold fewer than zero people. Net-count drift can push the raw
  // number negative; clamp for display and let the organizer reset the zone.
  for (const [id, n] of counts) counts.set(id, Math.max(0, n))
  return counts
}

/** Net change per zone over a window - used for the 10-minute trend. */
export function computeNetChange(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
): Map<string, number> {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const net = new Map<string, number>()
  for (const z of zones) net.set(z.id, 0)

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const ms = tap.clientTs.toMillis()
    if (ms < fromMs || ms > toMs) continue
    for (const { zoneId, delta } of tapDeltas(cp, tap)) {
      if (!net.has(zoneId)) continue
      net.set(zoneId, (net.get(zoneId) ?? 0) + delta)
    }
  }
  return net
}

/** When each checkpoint last recorded a tap, in ms. Missing = never. */
export function lastTapByCheckpoint(taps: Tap[]): Map<string, number> {
  const last = new Map<string, number>()
  for (const tap of taps) {
    if (tap.undone) continue
    const ms = tap.clientTs.toMillis()
    const prev = last.get(tap.checkpointId)
    if (prev === undefined || ms > prev) last.set(tap.checkpointId, ms)
  }
  return last
}

/**
 * Straight-line forecast: at the current rate, how many minutes until this zone
 * reaches capacity? Null when it is already full, flat, or emptying.
 */
export function minutesToCapacity(
  occupancy: number,
  capacity: number,
  netPerWindow: number,
  windowMinutes: number,
): number | null {
  if (netPerWindow <= 0) return null
  if (occupancy >= capacity) return 0
  const perMinute = netPerWindow / windowMinutes
  return (capacity - occupancy) / perMinute
}
