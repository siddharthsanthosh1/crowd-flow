import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { RESET_VARIANCE, measure, predict, sigma, siteVariance, zoneVariance } from './band'
import { OUTSIDE } from '../../types'
import type { Checkpoint, Reset, Tap, Zone } from '../../types'

const zones: Zone[] = [
  { id: 'lawn', name: 'Lawn', capacity: 100, order: 0 },
  { id: 'food', name: 'Food', capacity: 100, order: 1 },
]
const checkpoints: Checkpoint[] = [
  { id: 'gate', name: 'Gate', fromZoneId: OUTSIDE, toZoneId: 'lawn', token: 't1', order: 0 },
  { id: 'path', name: 'Path', fromZoneId: 'lawn', toZoneId: 'food', token: 't2', order: 1 },
]
const MIN = 60_000
let n = 0
const tap = (checkpointId: string, direction: 'in' | 'out', m: number, undone = false): Tap => ({
  id: `t${n++}`,
  checkpointId,
  direction,
  clientTs: Timestamp.fromMillis(m * MIN),
  serverTs: null,
  deviceId: 'd',
  undone,
})
const reset = (zoneId: string, m: number): Reset => ({
  id: `r${m}`,
  zoneId,
  newCount: 0,
  ts: Timestamp.fromMillis(m * MIN),
})

describe('variance accumulation', () => {
  it('adds p(1 - p) per tap', () => {
    expect(predict(0, 100, 0.03)).toBeCloseTo(100 * 0.03 * 0.97, 10)
    expect(predict(2, 1, 0.5)).toBeCloseTo(2.25, 10)
  })

  it('a reset pulls the variance down to about the reset noise', () => {
    const before = predict(0, 10_000, 0.03)
    const after = measure(before)
    expect(after).toBeLessThan(RESET_VARIANCE)
    expect(after).toBeCloseTo((before * RESET_VARIANCE) / (before + RESET_VARIANCE), 10)
  })

  it('sigma is the rounded square root', () => {
    expect(sigma(predict(0, 1000, 0.03))).toBe(5) // sqrt(29.1) = 5.39
  })

  it('counts each tap on every real zone it touches, and skips undone taps', () => {
    const taps = [
      tap('gate', 'in', 1),
      tap('gate', 'in', 2),
      tap('path', 'in', 3),
      tap('path', 'in', 4, true),
    ]
    const v = zoneVariance(zones, checkpoints, taps, [], 0.1, 10 * MIN)
    expect(v.get('lawn')).toBeCloseTo(3 * 0.09, 10) // two gate taps + one path tap
    expect(v.get('food')).toBeCloseTo(1 * 0.09, 10)
  })

  it('a reset restarts the accumulation for that zone only', () => {
    const taps = [tap('gate', 'in', 1), tap('path', 'in', 2), tap('path', 'in', 6)]
    const v = zoneVariance(zones, checkpoints, taps, [reset('food', 5)], 0.1, 10 * MIN)
    expect(v.get('lawn')).toBeCloseTo(3 * 0.09, 10)
    // Food: 0.09, measured down to 0.09*1/1.09, then one more tap.
    expect(v.get('food')).toBeCloseTo(0.09 / 1.09 + 0.09, 10)
  })

  it('ignores taps after the requested time', () => {
    const taps = [tap('gate', 'in', 1), tap('gate', 'in', 20)]
    expect(zoneVariance(zones, checkpoints, taps, [], 0.1, 10 * MIN).get('lawn')).toBeCloseTo(0.09, 10)
  })

  it('attendance counts gate arrivals; on-site counts both directions', () => {
    const taps = [tap('gate', 'in', 1), tap('gate', 'in', 2), tap('gate', 'out', 3), tap('path', 'in', 4)]
    const v = siteVariance(checkpoints, taps, 0.1, 10 * MIN)
    expect(v.attendance).toBeCloseTo(2 * 0.09, 10)
    expect(v.onSite).toBeCloseTo(3 * 0.09, 10)
  })
})
