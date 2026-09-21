import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { MIN_SAMPLES, foodArrivals, pooledMu, queueBins, truckRates, whatIf } from './queue'
import { staffingBlocks } from './staffing'
import { consistencyFlags, innerZones } from './checks'
import { OUTSIDE } from '../../types'
import type { Checkpoint, Tap, Zone } from '../../types'
import type { ServiceTime, Truck } from './types'

const MIN = 60_000
const zones: Zone[] = [
  { id: 'lawn', name: 'Lawn', capacity: 100, order: 0 },
  { id: 'food', name: 'Food', capacity: 100, order: 1 },
]
const checkpoints: Checkpoint[] = [
  { id: 'gate', name: 'Gate', fromZoneId: OUTSIDE, toZoneId: 'lawn', token: 'a', order: 0 },
  { id: 'path', name: 'Path', fromZoneId: 'lawn', toZoneId: 'food', token: 'b', order: 1 },
]
let n = 0
const tap = (checkpointId: string, direction: 'in' | 'out', ms: number): Tap => ({
  id: `t${n++}`,
  checkpointId,
  direction,
  clientTs: Timestamp.fromMillis(ms),
  serverTs: null,
  deviceId: 'd',
  undone: false,
})
const sample = (truckId: string, sec: number, undone = false): ServiceTime => ({
  id: `s${n++}`,
  truckId,
  durationMs: sec * 1000,
  clientTs: Timestamp.fromMillis(0),
  serverTs: null,
  deviceId: 'd',
  undone,
})

describe('service rates', () => {
  const trucks: Truck[] = [
    { id: 'a', name: 'A', order: 0 },
    { id: 'b', name: 'B', order: 1 },
  ]

  it('needs MIN_SAMPLES before a truck counts, and ignores undone samples', () => {
    const samples = [
      ...Array.from({ length: MIN_SAMPLES }, () => sample('a', 120)),
      ...Array.from({ length: MIN_SAMPLES - 1 }, () => sample('b', 60)),
      sample('b', 60, true),
    ]
    const rates = truckRates(trucks, samples)
    expect(rates[0].muPerMin).toBeCloseTo(0.5, 10)
    expect(rates[1].muPerMin).toBeNull()
    expect(rates[1].samples).toBe(MIN_SAMPLES - 1)
    expect(pooledMu(rates)).toBeCloseTo(0.5, 10)
  })

  it('pools as the mean of per-truck μ', () => {
    const samples = [
      ...Array.from({ length: MIN_SAMPLES }, () => sample('a', 120)),
      ...Array.from({ length: MIN_SAMPLES }, () => sample('b', 60)),
    ]
    expect(pooledMu(truckRates(trucks, samples))).toBeCloseTo((0.5 + 1) / 2, 10)
  })
})

describe('food queue', () => {
  // 20 people into the food zone in each of two 5-minute blocks: 4 / min.
  const taps = [
    ...Array.from({ length: 20 }, (_, i) => tap('path', 'in', i * 15_000)),
    ...Array.from({ length: 20 }, (_, i) => tap('path', 'in', 5 * MIN + i * 15_000)),
    tap('path', 'out', MIN), // leaving the food zone is not an arrival
  ]
  const arrivals = foodArrivals('food', checkpoints, taps, 0, 10 * MIN)

  it('bins arrivals into the food zone per minute', () => {
    expect(arrivals.map((a) => a.perMin)).toEqual([4, 4])
  })

  it('λ is arrivals times the order share', () => {
    const bins = queueBins(arrivals, 0.5, 3, 1)
    expect(bins[0].lambda).toBe(2)
    expect(bins[0].rho).toBeCloseTo(2 / 3, 10)
    expect(bins[0].wqMin).toBeCloseTo((4 / 9) / (3 - 2), 10)
  })

  it('reports a growing line at ρ ≥ 1', () => {
    expect(queueBins(arrivals, 1, 3, 1)[0].wqMin).toBeNull()
  })

  it('what-if spans actual - 1 to actual + 2 and picks the smallest c under target', () => {
    const { rows, recommended } = whatIf(arrivals, 1, 4, 1, 10)
    expect(rows.map((r) => r.servers)).toEqual([3, 4, 5, 6])
    expect(rows[0].growingMin).toBe(10) // 4/min into 3 servers at 1/min
    expect(rows[1].growingMin).toBe(10) // ρ = 1 exactly is still growing
    expect(rows[2].growingMin).toBe(0)
    expect(recommended).toBe(5)
  })

  it('a tighter target needs more servers', () => {
    expect(whatIf(arrivals, 1, 4, 1, 0.5).recommended).toBe(6)
    expect(whatIf(arrivals, 1, 4, 1, 0.1).recommended).toBeNull()
  })
})

describe('staffing', () => {
  it('uses the block peak and rounds staff up', () => {
    const site = [0, 5, 10, 15, 20, 25].map((m, i) => ({
      t: m * MIN,
      arrivals: 0,
      departures: 0,
      onSite: [10, 50, 30, 101, 20, 0][i],
      cumulativeArrivals: 0,
    }))
    const blocks = staffingBlocks(site, 25)
    expect(blocks.map((b) => b.peakOnSite)).toEqual([50, 101])
    expect(blocks.map((b) => b.staff)).toEqual([2, 5])
    expect(blocks.map((b) => b.isPeak)).toEqual([false, true])
  })

  it('no ratio, no table', () => {
    expect(staffingBlocks([], 25)).toEqual([])
  })
})

describe('consistency flags', () => {
  it('finds inner zones as the ones with no gate', () => {
    expect(innerZones(zones, checkpoints).map((z) => z.id)).toEqual(['food'])
  })

  it('flags a zone going below zero, naming it and the time', () => {
    const taps = [tap('gate', 'in', 0), tap('path', 'out', 2 * MIN)]
    const flags = consistencyFlags(zones, checkpoints, taps, [], 0, 5 * MIN, () => 0)
    const neg = flags.find((f) => f.kind === 'negative_zone')
    expect(neg?.where).toBe('Food')
    expect(neg?.at).toBe(2 * MIN)
  })

  it('flags inner areas holding more than the gates count, beyond the band', () => {
    // Nobody came through the gate, but three walked into food.
    const taps = [0, 1, 2].map((i) => tap('path', 'in', i * 1000))
    expect(consistencyFlags(zones, checkpoints, taps, [], 0, 2 * MIN, () => 0).some((f) => f.kind === 'inner_exceeds_gate')).toBe(true)
    expect(consistencyFlags(zones, checkpoints, taps, [], 0, 2 * MIN, () => 5).some((f) => f.kind === 'inner_exceeds_gate')).toBe(false)
  })

  it('flags OUT above IN by more than 10% only once it has lasted 15 minutes', () => {
    const taps = [
      ...Array.from({ length: 10 }, () => tap('gate', 'in', 0)),
      ...Array.from({ length: 12 }, () => tap('gate', 'out', MIN)),
    ]
    const short = consistencyFlags(zones, checkpoints, taps, [], 0, 10 * MIN, () => 0)
    expect(short.some((f) => f.kind === 'out_exceeds_in')).toBe(false)
    const long = consistencyFlags(zones, checkpoints, taps, [], 0, 20 * MIN, () => 0)
    const f = long.find((x) => x.kind === 'out_exceeds_in')
    expect(f?.where).toBe('Gate')
    expect(f?.at).toBe(MIN)
  })

  it('a clean evening raises nothing', () => {
    const taps = [
      ...Array.from({ length: 10 }, (_, i) => tap('gate', 'in', i * 1000)),
      ...Array.from({ length: 5 }, (_, i) => tap('path', 'in', MIN + i * 1000)),
      ...Array.from({ length: 5 }, (_, i) => tap('path', 'out', 3 * MIN + i * 1000)),
      ...Array.from({ length: 10 }, (_, i) => tap('gate', 'out', 4 * MIN + i * 1000)),
    ]
    expect(consistencyFlags(zones, checkpoints, taps, [], 0, 30 * MIN, () => 0)).toEqual([])
  })
})
