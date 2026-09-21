import type { Checkpoint, Reset, Tap, Zone } from '../../types'
import { OUTSIDE } from '../../types'
import { siteFlow } from '../series'
import { consistencyFlags, innerZones } from './checks'
import type { ConsistencyFlag } from './checks'
import { sigma, siteVariance, zoneVariance } from './band'
import {
  SENSITIVITY_SHARES,
  foodArrivals,
  pooledMu,
  queueBins,
  truckRates,
  whatIf,
} from './queue'
import type { QueueBin, TruckRate, WhatIfRow } from './queue'
import { staffingBlocks } from './staffing'
import type { StaffBlock } from './staffing'
import { DEFAULT_MISS_PROB, DEFAULT_TARGET_WAIT_MIN } from './types'
import type { PlanningConfig, ServiceTime, Truck } from './types'

const MINUTE = 60_000

export type Assumption = {
  label: string
  value: string
  source: 'organizer' | 'default' | 'missing' | 'model'
}

/** Missed-tap probability and the counting band. Cheap; the dashboard runs it every second. */
export function bands(
  planning: PlanningConfig,
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  at: number,
): { attendance: number; zones: Map<string, number> } {
  const p = planning.missProb ?? DEFAULT_MISS_PROB
  const zv = zoneVariance(zones, checkpoints, taps, resets, p, at)
  return {
    attendance: sigma(siteVariance(checkpoints, taps, p, at).attendance),
    zones: new Map([...zv].map(([id, v]) => [id, sigma(v)])),
  }
}

/**
 * ± one standard deviation for "inner zones minus gate on-site" at any time,
 * from how many taps touched each by then. Resets are ignored here, which only
 * widens the allowance - the check errs towards staying quiet.
 */
export function innerGateBand(
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  p: number,
): (t: number) => number {
  const inner = new Set(innerZones(zones, checkpoints).map((z) => z.id))
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  const times: number[] = []
  const weights: number[] = []
  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    let w = 0
    if (cp.fromZoneId === OUTSIDE || cp.toZoneId === OUTSIDE) w++
    if (inner.has(cp.fromZoneId)) w++
    if (inner.has(cp.toZoneId)) w++
    if (w === 0) continue
    times.push(tap.clientTs.toMillis())
    weights.push(w)
  }
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b])
  const sortedT = order.map((i) => times[i])
  const cum: number[] = []
  let run = 0
  for (const i of order) cum.push((run += weights[i]))
  const q = p * (1 - p)
  return (t: number) => {
    let lo = 0
    let hi = sortedT.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sortedT[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return Math.sqrt((lo > 0 ? cum[lo - 1] : 0) * q)
  }
}

export function checksFor(
  planning: PlanningConfig,
  zones: Zone[],
  checkpoints: Checkpoint[],
  taps: Tap[],
  resets: Reset[],
  fromMs: number,
  toMs: number,
): ConsistencyFlag[] {
  const p = planning.missProb ?? DEFAULT_MISS_PROB
  return consistencyFlags(zones, checkpoints, taps, resets, fromMs, toMs, innerGateBand(zones, checkpoints, taps, p))
}

export type FoodScenario = {
  share: number
  bins: QueueBin[]
  rows: WhatIfRow[]
  recommended: number | null
  peakBin: QueueBin | null
}

export type FoodModel =
  | { status: 'no-zone' }
  | { status: 'no-trucks' }
  | { status: 'no-samples'; rates: TruckRate[] }
  | {
      status: 'ready'
      rates: TruckRate[]
      servers: number
      mu: number
      targetMin: number
      /** True when the organizer has not entered an order share yet. */
      sensitivity: boolean
      scenarios: FoodScenario[]
    }

export function foodModel(
  planning: PlanningConfig,
  checkpoints: Checkpoint[],
  taps: Tap[],
  trucks: Truck[],
  samples: ServiceTime[],
  fromMs: number,
  toMs: number,
): FoodModel {
  if (!planning.foodZoneId) return { status: 'no-zone' }
  if (trucks.length === 0) return { status: 'no-trucks' }
  const rates = truckRates(trucks, samples)
  const mu = pooledMu(rates)
  if (mu === null) return { status: 'no-samples', rates }

  const arrivals = foodArrivals(planning.foodZoneId, checkpoints, taps, fromMs, toMs)
  const servers = trucks.length
  const targetMin = planning.targetWaitMin ?? DEFAULT_TARGET_WAIT_MIN
  const shares = planning.orderShare !== undefined ? [planning.orderShare] : SENSITIVITY_SHARES
  const scenarios = shares.map((share) => {
    const bins = queueBins(arrivals, share, servers, mu)
    const { rows, recommended } = whatIf(arrivals, share, servers, mu, targetMin)
    const peakBin = bins.reduce<QueueBin | null>(
      (best, b) => (best === null || b.rho > best.rho ? b : best),
      null,
    )
    return { share, bins, rows, recommended, peakBin }
  })
  return {
    status: 'ready',
    rates,
    servers,
    mu,
    targetMin,
    sensitivity: planning.orderShare === undefined,
    scenarios,
  }
}

export function staffingFor(
  planning: PlanningConfig,
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
): StaffBlock[] | null {
  if (!planning.staffRatio) return null
  // Sampled every minute so a block's peak is not missed between samples.
  return staffingBlocks(siteFlow(checkpoints, taps, fromMs, toMs, MINUTE), planning.staffRatio)
}

export function assumptionsFor(planning: PlanningConfig, zones: Zone[], trucks: Truck[]): Assumption[] {
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
  const food = zones.find((z) => z.id === planning.foodZoneId)
  return [
    planning.missProb !== undefined
      ? { label: 'Chance a volunteer misses one person', value: pct(planning.missProb), source: 'organizer' }
      : { label: 'Chance a volunteer misses one person', value: pct(DEFAULT_MISS_PROB), source: 'default' },
    food
      ? { label: 'Food court zone', value: food.name, source: 'organizer' }
      : { label: 'Food court zone', value: 'not set', source: 'missing' },
    planning.orderShare !== undefined
      ? { label: 'Share of food-court visitors who order', value: pct(planning.orderShare), source: 'organizer' }
      : { label: 'Share of food-court visitors who order', value: 'not set - showing 50%, 75% and 100%', source: 'missing' },
    { label: 'Food trucks (servers, c)', value: String(trucks.length), source: 'organizer' },
    planning.targetWaitMin !== undefined
      ? { label: 'Longest acceptable food wait', value: `${planning.targetWaitMin} min`, source: 'organizer' }
      : { label: 'Longest acceptable food wait', value: `${DEFAULT_TARGET_WAIT_MIN} min`, source: 'default' },
    planning.staffRatio !== undefined
      ? { label: 'People on site per staff member', value: String(planning.staffRatio), source: 'organizer' }
      : { label: 'People on site per staff member', value: 'not set', source: 'missing' },
    { label: 'Minimum timed customers per truck', value: '8', source: 'model' },
    {
      label: 'Food-court queue',
      value: 'one pooled line (M/M/c): customers always pick the shortest line, so this is the best case',
      source: 'model',
    },
    {
      label: 'Queue blocks',
      value: 'each 5-minute block treated as settled; a real line lags behind a surge',
      source: 'model',
    },
    {
      label: 'Counting band',
      value: 'each person missed independently; double taps and silent phones not included',
      source: 'model',
    },
  ]
}
