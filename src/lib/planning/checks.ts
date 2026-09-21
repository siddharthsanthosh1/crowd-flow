import type { Checkpoint, Reset, Tap, Zone } from '../../types'
import { OUTSIDE } from '../../types'
import { siteCrossing } from './band'

/**
 * Cheap sanity checks on the tap log. Informational only: they name a place and
 * a time for a person to look at, and never change a count.
 */
export type ConsistencyFlag = {
  kind: 'negative_zone' | 'inner_exceeds_gate' | 'out_exceeds_in'
  /** When the condition started. */
  at: number
  /** The checkpoint or zone to look at. */
  where: string
  detail: string
}

const MINUTE = 60_000
/** A checkpoint must show OUT > IN by this share for this long before it is flagged. */
export const OUT_IN_TOLERANCE = 0.1
export const OUT_IN_WINDOW_MIN = 15
/** Sample spacing for the checks. */
const STEP_MS = MINUTE

/** Zones with no checkpoint to OUTSIDE: the ones only reachable from inside the site. */
export function innerZones(zones: Zone[], checkpoints: Checkpoint[]): Zone[] {
  const touchesGate = new Set<string>()
  for (const c of checkpoints) {
    if (c.fromZoneId === OUTSIDE) touchesGate.add(c.toZoneId)
    if (c.toZoneId === OUTSIDE) touchesGate.add(c.fromZoneId)
  }
  return zones.filter((z) => !touchesGate.has(z.id))
}

type Event =
  | { ms: number; kind: 'tap'; tap: Tap; cp: Checkpoint }
  | { ms: number; kind: 'reset'; zoneId: string; newCount: number }

/**
 * Replays the log once, minute by minute, and reports each condition the first
 * time it starts (and again if it clears and comes back).
 *
 * `bandAt(t)` supplies ± one standard deviation for the inner-vs-gate check, so
 * a gap smaller than the counting noise is not flagged.
 */
export function consistencyFlags(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  fromMs: number,
  toMs: number,
  bandAt: (t: number) => number,
): ConsistencyFlag[] {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const zoneName = new Map(zones.map((z) => [z.id, z.name]))
  const inner = new Set(innerZones(zones, checkpoints).map((z) => z.id))
  const hasGate = checkpoints.some((c) => c.fromZoneId === OUTSIDE || c.toZoneId === OUTSIDE)

  const events: Event[] = []
  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    events.push({ ms: tap.clientTs.toMillis(), kind: 'tap', tap, cp })
  }
  for (const r of resets) {
    events.push({ ms: r.ts ? r.ts.toMillis() : Date.now(), kind: 'reset', zoneId: r.zoneId, newCount: r.newCount })
  }
  events.sort((a, b) => a.ms - b.ms)

  // Raw, unclamped occupancy - the dashboard clamps at zero, which hides
  // exactly the thing the first check is looking for.
  const occ = new Map<string, number>(zones.map((z) => [z.id, 0]))
  let gateNet = 0
  const cum = new Map<string, { in: number; out: number }>(checkpoints.map((c) => [c.id, { in: 0, out: 0 }]))

  const flags: ConsistencyFlag[] = []
  const negativeSince = new Map<string, number>()
  let innerOverSince: number | null = null
  const outOverSince = new Map<string, number>()
  const outOverFlagged = new Set<string>()

  let i = 0
  for (let t = fromMs; t <= toMs; t += STEP_MS) {
    while (i < events.length && events[i].ms <= t) {
      const e = events[i++]
      if (e.kind === 'reset') {
        if (occ.has(e.zoneId)) occ.set(e.zoneId, e.newCount)
        continue
      }
      const { tap, cp } = e
      const entering = tap.direction === 'in' ? cp.toZoneId : cp.fromZoneId
      const leaving = tap.direction === 'in' ? cp.fromZoneId : cp.toZoneId
      if (occ.has(entering)) occ.set(entering, (occ.get(entering) ?? 0) + 1)
      if (occ.has(leaving)) occ.set(leaving, (occ.get(leaving) ?? 0) - 1)
      gateNet += siteCrossing(cp, tap.direction)
      // "IN" means onto the site at a gate drawn from the street; a gate drawn
      // the other way round has its directions swapped.
      const flip = cp.toZoneId === OUTSIDE
      const row = cum.get(cp.id)!
      if ((tap.direction === 'in') !== flip) row.in++
      else row.out++
    }

    // 1. A zone below zero.
    for (const [zoneId, n] of occ) {
      if (n < 0 && !negativeSince.has(zoneId)) {
        negativeSince.set(zoneId, t)
        flags.push({
          kind: 'negative_zone',
          at: t,
          where: zoneName.get(zoneId) ?? 'Unknown zone',
          detail: `count went below zero (${n}). More people were tapped out than in.`,
        })
      } else if (n >= 0) negativeSince.delete(zoneId)
    }

    // 2. Inner areas holding more people than the gates say are on site.
    if (hasGate && inner.size > 0) {
      let innerSum = 0
      for (const id of inner) innerSum += occ.get(id) ?? 0
      const excess = innerSum - gateNet
      const allowance = bandAt(t)
      if (excess > allowance) {
        if (innerOverSince === null) {
          innerOverSince = t
          flags.push({
            kind: 'inner_exceeds_gate',
            at: t,
            where: [...inner].map((id) => zoneName.get(id)).join(', '),
            detail: `inner areas hold ${innerSum.toLocaleString()} but the gates count ${gateNet.toLocaleString()} on site (allowing ±${Math.round(allowance)}).`,
          })
        }
      } else innerOverSince = null
    }

    // 3. A checkpoint where more have gone out than ever came in, for 15 minutes.
    for (const cp of checkpoints) {
      const row = cum.get(cp.id)!
      const over = row.out > row.in * (1 + OUT_IN_TOLERANCE) && row.out > 0
      if (!over) {
        outOverSince.delete(cp.id)
        outOverFlagged.delete(cp.id)
        continue
      }
      const since = outOverSince.get(cp.id) ?? t
      outOverSince.set(cp.id, since)
      if (!outOverFlagged.has(cp.id) && t - since >= OUT_IN_WINDOW_MIN * MINUTE) {
        outOverFlagged.add(cp.id)
        flags.push({
          kind: 'out_exceeds_in',
          at: since,
          where: cp.name,
          detail: `cumulative OUT (${row.out.toLocaleString()}) has been more than ${Math.round(OUT_IN_TOLERANCE * 100)}% above IN (${row.in.toLocaleString()}) for ${OUT_IN_WINDOW_MIN} minutes.`,
        })
      }
    }
  }
  return flags.sort((a, b) => a.at - b.at)
}
