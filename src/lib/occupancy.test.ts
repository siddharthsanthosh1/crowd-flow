import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  computeNetChange,
  computeOccupancy,
  lastTapByCheckpoint,
  minutesToCapacity,
} from './occupancy'
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
  { id: 'path', name: 'Path to food', fromZoneId: LAWN, toZoneId: FOOD, token: 't2', order: 1 },
]

const T0 = Date.parse('2026-10-17T17:00:00Z')
const min = (n: number) => T0 + n * 60_000

let seq = 0
function tap(
  checkpointId: string,
  direction: TapDirection,
  atMs: number,
  over: Partial<Tap> = {},
): Tap {
  return {
    id: `tap${seq++}`,
    checkpointId,
    direction,
    clientTs: Timestamp.fromMillis(atMs),
    serverTs: null,
    deviceId: 'device',
    undone: false,
    ...over,
  }
}

function reset(zoneId: string, newCount: number, atMs: number): Reset {
  return { id: `reset${seq++}`, zoneId, newCount, ts: Timestamp.fromMillis(atMs) }
}

describe('computeOccupancy', () => {
  it('counts entries from outside into a zone', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('gate', 'in', min(3)),
    ]
    const occ = computeOccupancy(zones, checkpoints, taps, [], min(10))
    expect(occ.get(LAWN)).toBe(3)
    expect(occ.get(FOOD)).toBe(0)
  })

  it('subtracts people leaving back outside', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('gate', 'out', min(3)),
    ]
    expect(computeOccupancy(zones, checkpoints, taps, [], min(10)).get(LAWN)).toBe(1)
  })

  it('moves a person between two zones without changing the total', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('path', 'in', min(3)), // lawn -> food
    ]
    const occ = computeOccupancy(zones, checkpoints, taps, [], min(10))
    expect(occ.get(LAWN)).toBe(1)
    expect(occ.get(FOOD)).toBe(1)
  })

  it('sends a person back the other way on an out tap', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('path', 'in', min(2)),
      tap('path', 'out', min(3)), // food -> lawn
    ]
    const occ = computeOccupancy(zones, checkpoints, taps, [], min(10))
    expect(occ.get(LAWN)).toBe(1)
    expect(occ.get(FOOD)).toBe(0)
  })

  it('ignores undone taps', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2), { undone: true }),
    ]
    expect(computeOccupancy(zones, checkpoints, taps, [], min(10)).get(LAWN)).toBe(1)
  })

  it('ignores taps after the requested time, which is what replay needs', () => {
    const taps = [tap('gate', 'in', min(1)), tap('gate', 'in', min(9))]
    expect(computeOccupancy(zones, checkpoints, taps, [], min(5)).get(LAWN)).toBe(1)
  })

  it('is order-independent, so late-syncing offline taps land correctly', () => {
    const inOrder = [tap('gate', 'in', min(1)), tap('gate', 'in', min(2)), tap('path', 'in', min(3))]
    const shuffled = [inOrder[2], inOrder[0], inOrder[1]]
    const a = computeOccupancy(zones, checkpoints, inOrder, [], min(10))
    const b = computeOccupancy(zones, checkpoints, shuffled, [], min(10))
    expect([...b]).toEqual([...a])
  })

  it('counts from the most recent reset and discards earlier taps', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(2)),
      tap('gate', 'in', min(6)),
    ]
    const resets = [reset(LAWN, 0, min(5))]
    expect(computeOccupancy(zones, checkpoints, taps, resets, min(10)).get(LAWN)).toBe(1)
  })

  it('uses the latest reset when there are several', () => {
    const taps = [tap('gate', 'in', min(1)), tap('gate', 'in', min(8))]
    const resets = [reset(LAWN, 500, min(3)), reset(LAWN, 0, min(7))]
    expect(computeOccupancy(zones, checkpoints, taps, resets, min(10)).get(LAWN)).toBe(1)
  })

  it('ignores resets that have not happened yet at the requested time', () => {
    const taps = [tap('gate', 'in', min(1))]
    const resets = [reset(LAWN, 0, min(9))]
    expect(computeOccupancy(zones, checkpoints, taps, resets, min(5)).get(LAWN)).toBe(1)
  })

  it('a reset on one zone leaves the others alone', () => {
    const taps = [tap('gate', 'in', min(1)), tap('path', 'in', min(2))]
    const resets = [reset(LAWN, 0, min(5))]
    const occ = computeOccupancy(zones, checkpoints, taps, resets, min(10))
    expect(occ.get(LAWN)).toBe(0)
    expect(occ.get(FOOD)).toBe(1)
  })

  it('never reports a negative occupancy', () => {
    const taps = [tap('gate', 'out', min(1)), tap('gate', 'out', min(2))]
    expect(computeOccupancy(zones, checkpoints, taps, [], min(10)).get(LAWN)).toBe(0)
  })

  it('ignores taps for a checkpoint that has been removed', () => {
    const taps = [tap('gate', 'in', min(1)), tap('deleted-cp', 'in', min(2))]
    expect(computeOccupancy(zones, checkpoints, taps, [], min(10)).get(LAWN)).toBe(1)
  })
})

describe('computeNetChange', () => {
  it('only counts taps inside the window', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(6)),
      tap('gate', 'in', min(7)),
    ]
    const net = computeNetChange(zones, checkpoints, taps, min(5), min(10))
    expect(net.get(LAWN)).toBe(2)
  })

  it('can be negative when a zone is emptying', () => {
    const taps = [tap('gate', 'out', min(6)), tap('gate', 'out', min(7))]
    expect(computeNetChange(zones, checkpoints, taps, min(5), min(10)).get(LAWN)).toBe(-2)
  })
})

describe('lastTapByCheckpoint', () => {
  it('reports the newest tap per checkpoint and skips undone ones', () => {
    const taps = [
      tap('gate', 'in', min(1)),
      tap('gate', 'in', min(4)),
      tap('gate', 'in', min(9), { undone: true }),
      tap('path', 'in', min(2)),
    ]
    const last = lastTapByCheckpoint(taps)
    expect(last.get('gate')).toBe(min(4))
    expect(last.get('path')).toBe(min(2))
  })
})

describe('minutesToCapacity', () => {
  it('extrapolates the current rate', () => {
    // 100 more people fit, filling at 50 per 10 minutes = 5/min -> 20 minutes.
    expect(minutesToCapacity(900, 1000, 50, 10)).toBe(20)
  })

  it('says nothing when flat or emptying', () => {
    expect(minutesToCapacity(900, 1000, 0, 10)).toBeNull()
    expect(minutesToCapacity(900, 1000, -20, 10)).toBeNull()
  })

  it('reports zero when already at capacity', () => {
    expect(minutesToCapacity(1000, 1000, 50, 10)).toBe(0)
  })
})
