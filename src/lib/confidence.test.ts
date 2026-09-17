import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  calibratedAt,
  confidenceFromMinutes,
  feedersOf,
  perMinute,
  perMinuteLabel,
  silentFeeders,
  watchZone,
  zoneConfidence,
} from './confidence'
import { OUTSIDE } from '../types'
import type { Checkpoint, Reset, Zone } from '../types'

const LAWN = 'lawn'
const FOOD = 'food'
const STAGE = 'stage'

const checkpoints: Checkpoint[] = [
  { id: 'gate', name: 'Gate A', fromZoneId: OUTSIDE, toZoneId: LAWN, token: 't1', order: 0 },
  { id: 'path', name: 'Path to food', fromZoneId: LAWN, toZoneId: FOOD, token: 't2', order: 1 },
  { id: 'stagein', name: 'Stage entrance', fromZoneId: LAWN, toZoneId: STAGE, token: 't3', order: 2 },
]

const T0 = Date.parse('2026-10-17T17:00:00Z')
const min = (n: number) => T0 + n * 60_000

const reset = (zoneId: string, atMin: number): Reset => ({
  id: `r-${zoneId}-${atMin}`,
  zoneId,
  newCount: 0,
  ts: Timestamp.fromMillis(min(atMin)),
})

describe('confidence bands', () => {
  it('is high for the first half hour, then steps down', () => {
    expect(confidenceFromMinutes(0)).toBe('high')
    expect(confidenceFromMinutes(29.9)).toBe('high')
    expect(confidenceFromMinutes(30)).toBe('medium')
    expect(confidenceFromMinutes(89.9)).toBe('medium')
    expect(confidenceFromMinutes(90)).toBe('low')
    expect(confidenceFromMinutes(400)).toBe('low')
  })

  it('counts from the event start when a zone has never been reset', () => {
    const c = zoneConfidence(LAWN, T0, [], min(45))
    expect(c.level).toBe('medium')
    expect(c.minutesSince).toBeCloseTo(45)
    expect(c.fromReset).toBe(false)
  })

  it('a reset restores the zone to high, and only that zone', () => {
    const resets = [reset(LAWN, 100)]
    const lawn = zoneConfidence(LAWN, T0, resets, min(110))
    expect(lawn.level).toBe('high')
    expect(lawn.minutesSince).toBeCloseTo(10)
    expect(lawn.fromReset).toBe(true)

    expect(zoneConfidence(FOOD, T0, resets, min(110)).level).toBe('low')
  })

  it('uses the most recent reset when there are several', () => {
    expect(calibratedAt(LAWN, T0, [reset(LAWN, 20), reset(LAWN, 80), reset(LAWN, 50)])).toBe(min(80))
  })

  it('ignores a reset that has not reached the server, rather than reading it as 1970', () => {
    const pending: Reset = { id: 'p', zoneId: LAWN, newCount: 0, ts: null }
    // A null ts is treated as "just now", so it can only move calibration forward.
    expect(calibratedAt(LAWN, T0, [pending])).toBeGreaterThanOrEqual(T0)
  })
})

describe('silent feeders', () => {
  it('names every checkpoint that changes the zone, in either direction', () => {
    expect(feedersOf(LAWN, checkpoints).map((c) => c.id)).toEqual(['gate', 'path', 'stagein'])
    expect(feedersOf(FOOD, checkpoints).map((c) => c.id)).toEqual(['path'])
  })

  it('reports a feeder quiet for longer than the threshold', () => {
    const lastTap = new Map([
      ['gate', min(59)],
      ['path', min(50)],
      ['stagein', min(58)],
    ])
    const silent = silentFeeders(LAWN, checkpoints, lastTap, T0, min(60))
    expect(silent.map((s) => s.checkpoint.id)).toEqual(['path'])
    expect(silent[0].since).toBe(min(50))
    expect(silent[0].everReported).toBe(true)
  })

  it('does not cry wolf in the first minutes, before anyone would have tapped', () => {
    expect(silentFeeders(LAWN, checkpoints, new Map(), T0, min(3))).toEqual([])
  })

  it('catches a post that was never staffed at all', () => {
    const silent = silentFeeders(FOOD, checkpoints, new Map(), T0, min(20))
    expect(silent).toHaveLength(1)
    expect(silent[0].everReported).toBe(false)
    expect(silent[0].since).toBe(T0)
  })
})

describe('rate', () => {
  it('converts a windowed net change to people per minute', () => {
    expect(perMinute(40, 10)).toBe(4)
    expect(perMinute(-5, 10)).toBe(-0.5)
    expect(perMinute(5, 0)).toBe(0)
  })

  it('keeps one decimal, so a slow trend is not rounded away to zero', () => {
    expect(perMinuteLabel(4.24)).toBe('+4.2 / min')
    expect(perMinuteLabel(-0.7)).toBe('-0.7 / min')
    expect(perMinuteLabel(0.4)).toBe('+0.4 / min')
    expect(perMinuteLabel(0)).toBe('0 / min')
    expect(perMinuteLabel(0.01)).toBe('0 / min')
  })
})

describe('watch zone', () => {
  const z = (id: string): Zone => ({ id, name: id, capacity: 100, order: 0 })

  it('picks the zone that fills soonest', () => {
    const picked = watchZone([
      { zone: z(LAWN), pct: 90, minutesToCapacity: 20 },
      { zone: z(STAGE), pct: 71, minutesToCapacity: 9 },
      { zone: z(FOOD), pct: 40, minutesToCapacity: null },
    ])
    expect(picked?.zone.id).toBe(STAGE)
  })

  it('is null when nothing is trending up', () => {
    expect(
      watchZone([
        { zone: z(LAWN), pct: 90, minutesToCapacity: null },
        { zone: z(FOOD), pct: 40, minutesToCapacity: null },
      ]),
    ).toBeNull()
  })
})
