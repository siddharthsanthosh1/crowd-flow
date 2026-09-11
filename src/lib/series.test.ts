import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { computeOccupancy } from './occupancy'
import {
  checkpointThroughput,
  dwellMinutes,
  forecastLine,
  projectedOccupancy,
  replayZones,
  siteFlow,
  zoneArrivalRate,
} from './series'
import { OUTSIDE } from '../types'
import type { Checkpoint, Reset, Tap, TapDirection, Zone } from '../types'

const LAWN = 'lawn'
const FOOD = 'food'

const zones: Zone[] = [
  { id: LAWN, name: 'Main Lawn', capacity: 1000, order: 0 },
  { id: FOOD, name: 'Food Court', capacity: 200, order: 1 },
]
const checkpoints: Checkpoint[] = [
  { id: 'gate', name: 'Gate A', fromZoneId: OUTSIDE, toZoneId: LAWN, token: 't1', order: 0 },
  { id: 'path', name: 'Path', fromZoneId: LAWN, toZoneId: FOOD, token: 't2', order: 1 },
  { id: 'exit', name: 'Exit', fromZoneId: FOOD, toZoneId: OUTSIDE, token: 't3', order: 2 },
]

const T0 = Date.parse('2026-10-17T17:00:00Z')
const min = (n: number) => T0 + n * 60_000
const MINUTE = 60_000

let seq = 0
const tap = (cp: string, dir: TapDirection, atMs: number, over: Partial<Tap> = {}): Tap => ({
  id: `tap${seq++}`,
  checkpointId: cp,
  direction: dir,
  clientTs: Timestamp.fromMillis(atMs),
  serverTs: null,
  deviceId: 'device',
  undone: false,
  ...over,
})
const reset = (zoneId: string, newCount: number, atMs: number): Reset => ({
  id: `reset${seq++}`,
  zoneId,
  newCount,
  ts: Timestamp.fromMillis(atMs),
})

describe('replayZones', () => {
  it('samples occupancy at each bucket boundary', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(3)),
    ]
    const series = replayZones(zones, checkpoints, taps, [], min(0), min(4), MINUTE)
    expect(series.get(LAWN)!.points.map((p) => p.v)).toEqual([0, 2, 2, 3, 3])
  })

  it('agrees with computeOccupancy at every sampled point', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('path', 'in', min(3)),
      tap('gate', 'in', min(4)),
      tap('exit', 'in', min(5)),
      tap('gate', 'out', min(6)),
      tap('gate', 'in', min(7), { undone: true }),
    ]
    const resets = [reset(LAWN, 10, min(4) + 30_000)]
    const series = replayZones(zones, checkpoints, taps, resets, min(0), min(8), MINUTE)
    for (const zone of zones) {
      for (const point of series.get(zone.id)!.points) {
        const direct = computeOccupancy(zones, checkpoints, taps, resets, point.t)
        expect(`${zone.id}@${point.t} = ${point.v}`).toBe(
          `${zone.id}@${point.t} = ${direct.get(zone.id)}`,
        )
      }
    }
  })

  it('records the peak and when it happened, including between samples', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(1)),
      // Spikes to 4 and falls back to 1, entirely inside one bucket.
      tap('gate', 'in', min(2) + 10_000),
      tap('gate', 'out', min(2) + 20_000),
      tap('gate', 'out', min(2) + 30_000),
      tap('gate', 'out', min(2) + 40_000),
    ]
    const series = replayZones(zones, checkpoints, taps, [], min(0), min(4), MINUTE)
    expect(series.get(LAWN)!.peak.value).toBe(4)
    expect(series.get(LAWN)!.peak.at).toBe(min(2) + 10_000)
    expect(series.get(LAWN)!.points.at(-1)!.v).toBe(1)
  })

  it('carries occupancy from before the window into the first point', () => {
    const taps = [tap('gate', 'in', min(1)), tap('gate', 'in', min(2))]
    const series = replayZones(zones, checkpoints, taps, [], min(10), min(12), MINUTE)
    expect(series.get(LAWN)!.points.map((p) => p.v)).toEqual([2, 2, 2])
  })

  it('never reports a negative occupancy', () => {
    const taps = [tap('gate', 'out', min(1)), tap('gate', 'out', min(2))]
    const series = replayZones(zones, checkpoints, taps, [], min(0), min(3), MINUTE)
    expect(series.get(LAWN)!.points.every((p) => p.v >= 0)).toBe(true)
  })
})

describe('siteFlow', () => {
  it('counts arrivals and departures across the OUTSIDE boundary only', () => {
    const taps = [
      tap('gate', 'in', min(1)), // arrival
      tap('gate', 'in', min(1)), // arrival
      tap('path', 'in', min(1)), // internal move, not an arrival
      tap('exit', 'in', min(2)), // Food -> OUTSIDE, a departure
      tap('gate', 'out', min(2)), // Lawn -> OUTSIDE, a departure
    ]
    const flow = siteFlow(checkpoints, taps, min(0), min(3), MINUTE)
    expect(flow.map((b) => b.arrivals)).toEqual([0, 2, 0, 0])
    expect(flow.map((b) => b.departures)).toEqual([0, 0, 2, 0])
    expect(flow.map((b) => b.onSite)).toEqual([0, 2, 0, 0])
  })

  it('treats an out tap at an exit-facing checkpoint as an arrival', () => {
    // Exit is Food -> OUTSIDE, so "out" means OUTSIDE -> Food: someone arriving.
    const flow = siteFlow(checkpoints, [tap('exit', 'out', min(1))], min(0), min(2), MINUTE)
    expect(flow.map((b) => b.arrivals)).toEqual([0, 1, 0])
  })

  it('cumulative arrivals never decrease', () => {
    const taps = [tap('gate', 'in', min(1)), tap('gate', 'out', min(2)), tap('gate', 'out', min(3))]
    const flow = siteFlow(checkpoints, taps, min(0), min(4), MINUTE)
    const cumulative = flow.map((b) => b.cumulativeArrivals)
    expect(cumulative).toEqual([...cumulative].sort((a, b) => a - b))
  })

  it('includes taps from before the window in the running totals', () => {
    const taps = [tap('gate', 'in', min(1)), tap('gate', 'in', min(2))]
    const flow = siteFlow(checkpoints, taps, min(10), min(11), MINUTE)
    expect(flow[0].onSite).toBe(2)
    expect(flow[0].arrivals).toBe(0)
  })
})

describe('checkpointThroughput', () => {
  it('reports people per minute over the window', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('gate', 'out', min(3)),
      tap('path', 'in', min(4)),
    ]
    const rows = checkpointThroughput(checkpoints, taps, min(0), min(10))
    const gate = rows.find((r) => r.checkpointId === 'gate')!
    expect(gate.in).toBe(2)
    expect(gate.out).toBe(1)
    expect(gate.perMinute).toBeCloseTo(0.3)
  })
})

describe('zoneArrivalRate and dwellMinutes', () => {
  it('counts entries into a zone regardless of which side they came from', () => {
    const taps = [
      tap('gate', 'in', min(1)), // -> Lawn
      tap('path', 'in', min(2)), // Lawn -> Food
      tap('path', 'out', min(3)), // Food -> Lawn
    ]
    const rate = zoneArrivalRate(zones, checkpoints, taps, min(0), min(10))
    expect(rate.get(LAWN)).toBeCloseTo(0.2) // two entries over 10 minutes
    expect(rate.get(FOOD)).toBeCloseTo(0.1)
  })

  it('estimates dwell from occupancy over arrival rate', () => {
    expect(dwellMinutes(60, 3)).toBe(20)
    expect(dwellMinutes(60, 0)).toBeNull()
  })
})

describe('forecastLine', () => {
  it('extends from the last real point at the trailing rate', () => {
    const points = forecastLine({ t: min(10), v: 100 }, 50, 10, 15, 5 * MINUTE)
    expect(points[0]).toEqual({ t: min(10), v: 100 })
    expect(points.at(-1)!.t).toBe(min(25))
    expect(points.at(-1)!.v).toBe(175)
  })

  it('does not project below zero', () => {
    const points = forecastLine({ t: min(10), v: 10 }, -100, 10, 15, 5 * MINUTE)
    expect(points.every((p) => p.v >= 0)).toBe(true)
  })

  it('projectedOccupancy matches the end of the line', () => {
    expect(projectedOccupancy(100, 50, 10, 15)).toBe(175)
  })
})
