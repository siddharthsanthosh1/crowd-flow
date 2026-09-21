import type { Checkpoint, Reset, Tap, Zone } from '../../types'
import { OUTSIDE } from '../../types'

/**
 * How far off a count could reasonably be, from missed taps alone.
 *
 * The model is deliberately simple and it is an assumption, not a measurement:
 * every person who walks past a volunteer is missed independently with
 * probability p. One tap then carries a variance of p(1 - p), and a zone's
 * variance is that times the number of taps that have changed its count since
 * it was last reset.
 *
 * Written as a one-dimensional Kalman filter so a reset has a proper meaning.
 * Honestly, it is the variance half of one: taps are the predict step (process
 * noise q = p(1 - p) each), and an organizer's reset is a measurement with a
 * small noise R, which pulls the variance down to about R. The count itself is
 * never adjusted - the tap engine already sets it to the reset value, and the
 * gain on a near-exact measurement is 1 to within rounding. Nothing here
 * corrects counts; it only says how wide the uncertainty is.
 *
 * What the model leaves out: double taps, a volunteer who stops counting, and
 * the fact that misses bias a count low rather than spreading it evenly. The
 * band is a floor on the uncertainty, not a ceiling.
 */

/** Variance of an organizer's reset, in people². A near-exact headcount. */
export const RESET_VARIANCE = 1

/** Predict: n more taps, each missed with probability p. */
export function predict(variance: number, taps: number, p: number): number {
  return variance + taps * p * (1 - p)
}

/** Update: a reset is a measurement with variance R. Returns the posterior variance. */
export function measure(variance: number, r: number = RESET_VARIANCE): number {
  if (variance + r === 0) return 0
  const gain = variance / (variance + r)
  return (1 - gain) * variance
}

/** ± one standard deviation, rounded to whole people. */
export function sigma(variance: number): number {
  return Math.round(Math.sqrt(Math.max(0, variance)))
}

/**
 * Variance of every zone's count at time `at`, replaying taps and resets in
 * order. Uses the same rules as computeOccupancy: undone taps and taps before
 * a zone's latest reset do not count.
 */
export function zoneVariance(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  p: number,
  at: number = Date.now(),
): Map<string, number> {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  type Step = { ms: number; zoneId: string; reset: boolean }
  const steps: Step[] = []

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const ms = tap.clientTs.toMillis()
    if (ms > at) continue
    // A missed person is missing from both sides of the path.
    if (cp.fromZoneId !== OUTSIDE) steps.push({ ms, zoneId: cp.fromZoneId, reset: false })
    if (cp.toZoneId !== OUTSIDE) steps.push({ ms, zoneId: cp.toZoneId, reset: false })
  }
  for (const r of resets) {
    const ms = r.ts ? r.ts.toMillis() : Date.now()
    if (ms > at) continue
    steps.push({ ms, zoneId: r.zoneId, reset: true })
  }
  // A tap at the same instant as a reset is superseded by it, as in
  // computeOccupancy, so resets sort after taps on a tie.
  steps.sort((a, b) => a.ms - b.ms || Number(a.reset) - Number(b.reset))

  const variance = new Map<string, number>(zones.map((z) => [z.id, 0]))
  for (const s of steps) {
    const v = variance.get(s.zoneId)
    if (v === undefined) continue
    variance.set(s.zoneId, s.reset ? measure(v) : predict(v, 1, p))
  }
  return variance
}

/** Direction of a tap relative to the site boundary: +1 arriving, -1 leaving, 0 inside. */
export function siteCrossing(cp: Checkpoint, direction: 'in' | 'out'): 1 | -1 | 0 {
  const entering = direction === 'in' ? cp.toZoneId : cp.fromZoneId
  const leaving = direction === 'in' ? cp.fromZoneId : cp.toZoneId
  if (leaving === OUTSIDE && entering !== OUTSIDE) return 1
  if (entering === OUTSIDE && leaving !== OUTSIDE) return -1
  return 0
}

/**
 * Variance of total attendance (everyone who came in through a gate) and of
 * the gate's net on-site count, at time `at`. Attendance is never reset.
 */
export function siteVariance(
  checkpoints: Checkpoint[],
  taps: Tap[],
  p: number,
  at: number = Date.now(),
): { attendance: number; onSite: number } {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  let arrivals = 0
  let departures = 0
  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    if (tap.clientTs.toMillis() > at) continue
    const crossing = siteCrossing(cp, tap.direction)
    if (crossing === 1) arrivals++
    else if (crossing === -1) departures++
  }
  return {
    attendance: predict(0, arrivals, p),
    onSite: predict(0, arrivals + departures, p),
  }
}
