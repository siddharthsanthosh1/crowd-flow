import type { Checkpoint, Reset, Tap, Zone } from '../types'
import { OUTSIDE } from '../types'

export type Point = { t: number; v: number }

export type ZoneSeries = {
  points: Point[]
  peak: { value: number; at: number }
}

type Step =
  | { ms: number; kind: 'tap'; zoneId: string; delta: number }
  | { ms: number; kind: 'reset'; zoneId: string; newCount: number }

/**
 * Flatten taps and resets into one chronological list of changes.
 *
 * Everything in this file is built on a single pass over that list - the event
 * replayed from the beginning - rather than recomputing occupancy separately at
 * every point on the chart. One pass is O(taps); the naive version is
 * O(taps x points), which on a phone with a full evening of taps is the
 * difference between instant and janky.
 */
function steps(checkpoints: Checkpoint[], taps: Tap[], resets: Reset[]): Step[] {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const out: Step[] = []

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const ms = tap.clientTs.toMillis()
    const entering = tap.direction === 'in' ? cp.toZoneId : cp.fromZoneId
    const leaving = tap.direction === 'in' ? cp.fromZoneId : cp.toZoneId
    if (entering !== OUTSIDE) out.push({ ms, kind: 'tap', zoneId: entering, delta: 1 })
    if (leaving !== OUTSIDE) out.push({ ms, kind: 'tap', zoneId: leaving, delta: -1 })
  }

  for (const r of resets) {
    out.push({
      ms: r.ts ? r.ts.toMillis() : Date.now(),
      kind: 'reset',
      zoneId: r.zoneId,
      newCount: r.newCount,
    })
  }

  return out.sort((a, b) => a.ms - b.ms)
}

/**
 * Replay the event and sample each zone's occupancy at every bucket boundary in
 * [fromMs, toMs], plus its highest point of the whole event so far.
 *
 * Peak is tracked after every single change rather than only at the sampled
 * boundaries, so a brief surge between two samples still counts.
 */
export function replayZones(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): Map<string, ZoneSeries> {
  const known = new Set(zones.map((z) => z.id))
  const occupancy = new Map<string, number>()
  const peak = new Map<string, { value: number; at: number }>()
  const points = new Map<string, Point[]>()
  for (const z of zones) {
    occupancy.set(z.id, 0)
    peak.set(z.id, { value: 0, at: fromMs })
    points.set(z.id, [])
  }

  // A zone cannot hold fewer than zero people, but the running total is kept
  // unclamped so it matches computeOccupancy exactly; we clamp when reading.
  const read = (zoneId: string) => Math.max(0, occupancy.get(zoneId) ?? 0)

  const all = steps(checkpoints, taps, resets)
  let i = 0

  const apply = (upTo: number) => {
    while (i < all.length && all[i].ms <= upTo) {
      const step = all[i++]
      if (!known.has(step.zoneId)) continue
      if (step.kind === 'reset') occupancy.set(step.zoneId, step.newCount)
      else occupancy.set(step.zoneId, (occupancy.get(step.zoneId) ?? 0) + step.delta)

      const value = read(step.zoneId)
      const best = peak.get(step.zoneId)!
      if (value > best.value) peak.set(step.zoneId, { value, at: step.ms })
    }
  }

  for (let t = fromMs; t <= toMs; t += bucketMs) {
    apply(t)
    for (const z of zones) points.get(z.id)!.push({ t, v: read(z.id) })
  }
  // Anything after the last boundary still counts towards the peak.
  apply(toMs)

  const result = new Map<string, ZoneSeries>()
  for (const z of zones) {
    result.set(z.id, { points: points.get(z.id)!, peak: peak.get(z.id)! })
  }
  return result
}

/** Does this tap move someone onto the site, off it, or neither? */
function siteCrossing(cp: Checkpoint, direction: 'in' | 'out'): 1 | -1 | 0 {
  const entering = direction === 'in' ? cp.toZoneId : cp.fromZoneId
  const leaving = direction === 'in' ? cp.fromZoneId : cp.toZoneId
  if (leaving === OUTSIDE && entering !== OUTSIDE) return 1
  if (entering === OUTSIDE && leaving !== OUTSIDE) return -1
  return 0
}

export type SiteBucket = {
  t: number
  arrivals: number
  departures: number
  /** Everyone who has entered since the first tap, minus everyone who has left. */
  onSite: number
  /** Everyone who has entered since the first tap, never decreasing. */
  cumulativeArrivals: number
}

/**
 * Arrivals and departures per bucket, from checkpoints that touch OUTSIDE.
 * This is the only boundary with the rest of the world, so it is the only place
 * total attendance can be measured.
 */
export function siteFlow(
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): SiteBucket[] {
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const count = Math.max(1, Math.floor((toMs - fromMs) / bucketMs) + 1)
  const arrivals = new Array<number>(count).fill(0)
  const departures = new Array<number>(count).fill(0)

  // Everything before the window still counts towards the running totals.
  let priorArrivals = 0
  let priorDepartures = 0

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const crossing = siteCrossing(cp, tap.direction)
    if (crossing === 0) continue
    const ms = tap.clientTs.toMillis()
    if (ms > toMs) continue
    if (ms < fromMs) {
      if (crossing === 1) priorArrivals++
      else priorDepartures++
      continue
    }
    const idx = Math.min(count - 1, Math.floor((ms - fromMs) / bucketMs))
    if (crossing === 1) arrivals[idx]++
    else departures[idx]++
  }

  const out: SiteBucket[] = []
  let cumulativeArrivals = priorArrivals
  let cumulativeDepartures = priorDepartures
  for (let i = 0; i < count; i++) {
    cumulativeArrivals += arrivals[i]
    cumulativeDepartures += departures[i]
    out.push({
      t: fromMs + i * bucketMs,
      arrivals: arrivals[i],
      departures: departures[i],
      onSite: Math.max(0, cumulativeArrivals - cumulativeDepartures),
      cumulativeArrivals,
    })
  }
  return out
}

export type Throughput = {
  checkpointId: string
  in: number
  out: number
  total: number
  /** People crossing this point per minute over the window. */
  perMinute: number
}

export function checkpointThroughput(
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
): Throughput[] {
  const minutes = Math.max(1, (toMs - fromMs) / 60_000)
  const byId = new Map<string, { in: number; out: number }>()
  for (const c of checkpoints) byId.set(c.id, { in: 0, out: 0 })

  for (const tap of taps) {
    if (tap.undone) continue
    const row = byId.get(tap.checkpointId)
    if (!row) continue
    const ms = tap.clientTs.toMillis()
    if (ms < fromMs || ms > toMs) continue
    if (tap.direction === 'in') row.in++
    else row.out++
  }

  return checkpoints.map((c) => {
    const row = byId.get(c.id)!
    const total = row.in + row.out
    return {
      checkpointId: c.id,
      in: row.in,
      out: row.out,
      total,
      perMinute: total / minutes,
    }
  })
}

/** People entering each zone per minute - the arrival rate in Little's Law. */
export function zoneArrivalRate(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
): Map<string, number> {
  const minutes = Math.max(1, (toMs - fromMs) / 60_000)
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const entries = new Map<string, number>()
  for (const z of zones) entries.set(z.id, 0)

  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const ms = tap.clientTs.toMillis()
    if (ms < fromMs || ms > toMs) continue
    const entering = tap.direction === 'in' ? cp.toZoneId : cp.fromZoneId
    if (entering === OUTSIDE) continue
    if (!entries.has(entering)) continue
    entries.set(entering, (entries.get(entering) ?? 0) + 1)
  }

  const rate = new Map<string, number>()
  for (const [zoneId, n] of entries) rate.set(zoneId, n / minutes)
  return rate
}

/**
 * Little's Law: average time in the zone = how many are in it, divided by how
 * fast they are arriving. An estimate, and labelled as one everywhere it shows.
 * Null when nobody is arriving, because the answer would be infinite.
 */
export function dwellMinutes(occupancy: number, arrivalsPerMinute: number): number | null {
  if (arrivalsPerMinute <= 0) return null
  return occupancy / arrivalsPerMinute
}

/**
 * Straight-line projection from the current occupancy at the rate seen over the
 * trailing window. Returned as points so it can be drawn as a dashed
 * continuation of the real line.
 */
export function forecastLine(
  from: Point,
  netPerWindow: number,
  windowMinutes: number,
  horizonMinutes: number,
  bucketMs: number,
): Point[] {
  const perMs = netPerWindow / (windowMinutes * 60_000)
  const points: Point[] = []
  for (let t = from.t; t <= from.t + horizonMinutes * 60_000; t += bucketMs) {
    points.push({ t, v: Math.max(0, from.v + perMs * (t - from.t)) })
  }
  return points
}

/** Occupancy this zone is projected to reach `horizonMinutes` from now. */
export function projectedOccupancy(
  current: number,
  netPerWindow: number,
  windowMinutes: number,
  horizonMinutes: number,
): number {
  return Math.max(0, Math.round(current + (netPerWindow / windowMinutes) * horizonMinutes))
}
