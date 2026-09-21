import type { Checkpoint, Tap } from '../../types'
import { OUTSIDE } from '../../types'
import { mmc } from './erlang'
import type { ServiceTime, Truck } from './types'

/** Below this many timed customers a truck's average is not used. */
export const MIN_SAMPLES = 8
/** Width of each queue-model block. */
export const QUEUE_BIN_MIN = 5
/** Order shares shown side by side until the organizer enters one. */
export const SENSITIVITY_SHARES = [0.5, 0.75, 1]

export type TruckRate = {
  truck: Truck
  samples: number
  /** Mean service time, seconds. Null until MIN_SAMPLES are in. */
  meanSec: number | null
  /** Customers per minute, 1 / mean service time. Null until MIN_SAMPLES are in. */
  muPerMin: number | null
}

export function truckRates(trucks: Truck[], samples: ServiceTime[]): TruckRate[] {
  return trucks.map((truck) => {
    const mine = samples.filter((s) => s.truckId === truck.id && !s.undone)
    const n = mine.length
    if (n < MIN_SAMPLES) return { truck, samples: n, meanSec: null, muPerMin: null }
    const meanSec = mine.reduce((a, s) => a + s.durationMs, 0) / n / 1000
    return { truck, samples: n, meanSec, muPerMin: 60 / meanSec }
  })
}

/**
 * The pooled service rate: the plain mean of the per-truck μ values that have
 * enough samples. Null when no truck does.
 */
export function pooledMu(rates: TruckRate[]): number | null {
  const ready = rates.filter((r) => r.muPerMin !== null)
  if (ready.length === 0) return null
  return ready.reduce((a, r) => a + (r.muPerMin as number), 0) / ready.length
}

export type ArrivalBin = { t: number; perMin: number }

/**
 * People walking into the food zone, per minute, in 5-minute blocks. Every
 * checkpoint that leads into the zone counts - at the Diwali layout that is
 * the one post on the path to the food court.
 */
export function foodArrivals(
  foodZoneId: string,
  checkpoints: Checkpoint[],
  taps: Tap[],
  fromMs: number,
  toMs: number,
  binMin: number = QUEUE_BIN_MIN,
): ArrivalBin[] {
  const binMs = binMin * 60_000
  const count = Math.max(1, Math.ceil((toMs - fromMs) / binMs))
  const n = new Array<number>(count).fill(0)
  const cpById = new Map(checkpoints.map((c) => [c.id, c]))
  for (const tap of taps) {
    if (tap.undone) continue
    const cp = cpById.get(tap.checkpointId)
    if (!cp) continue
    const entering = tap.direction === 'in' ? cp.toZoneId : cp.fromZoneId
    if (entering !== foodZoneId || entering === OUTSIDE) continue
    const ms = tap.clientTs.toMillis()
    if (ms < fromMs || ms >= toMs) continue
    n[Math.floor((ms - fromMs) / binMs)]++
  }
  return n.map((people, i) => ({ t: fromMs + i * binMs, perMin: people / binMin }))
}

export type QueueBin = {
  t: number
  /** Ordering customers per minute. */
  lambda: number
  rho: number
  /** Expected wait in line, minutes. Null when the line is growing (ρ ≥ 1). */
  wqMin: number | null
}

export function queueBins(
  arrivals: ArrivalBin[],
  orderShare: number,
  servers: number,
  mu: number,
): QueueBin[] {
  return arrivals.map(({ t, perMin }) => {
    const lambda = perMin * orderShare
    const r = mmc(lambda, mu, servers)
    return { t, lambda, rho: r.rho, wqMin: r.growing ? null : r.wq }
  })
}

export type WhatIfRow = {
  servers: number
  /** Longest expected wait in any block where the line was stable, minutes. */
  peakWqMin: number
  /** Minutes spent with ρ ≥ 1, where no wait can be given because the line keeps growing. */
  growingMin: number
  /** Peak wait under target and no block with a growing line. */
  meetsTarget: boolean
}

export function whatIf(
  arrivals: ArrivalBin[],
  orderShare: number,
  actualServers: number,
  mu: number,
  targetMin: number,
  binMin: number = QUEUE_BIN_MIN,
): { rows: WhatIfRow[]; recommended: number | null } {
  const rows: WhatIfRow[] = []
  for (let c = Math.max(1, actualServers - 1); c <= actualServers + 2; c++) {
    const bins = queueBins(arrivals, orderShare, c, mu)
    const growingMin = bins.filter((b) => b.wqMin === null).length * binMin
    const peakWqMin = bins.reduce((m, b) => (b.wqMin !== null && b.wqMin > m ? b.wqMin : m), 0)
    rows.push({ servers: c, peakWqMin, growingMin, meetsTarget: growingMin === 0 && peakWqMin < targetMin })
  }
  const first = rows.find((r) => r.meetsTarget)
  return { rows, recommended: first ? first.servers : null }
}
