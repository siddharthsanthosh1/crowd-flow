import { describe, expect, it } from 'vitest'
import { HISTORY_MIN, SPAN_MIN, assignRoles, planFestival } from './simulate'
import { OUTSIDE } from '../types'
import type { Checkpoint, Zone } from '../types'

const zones: Zone[] = [
  { id: 'lawn', name: 'Main Lawn', capacity: 2500, order: 0 },
  { id: 'food', name: 'Food Court', capacity: 800, order: 1 },
  { id: 'stage', name: 'Stage Seating', capacity: 1200, order: 2 },
  { id: 'vendor', name: 'Vendor Row', capacity: 600, order: 3 },
]

const checkpoints: Checkpoint[] = [
  { id: 'gate', name: 'Gate A', fromZoneId: OUTSIDE, toZoneId: 'lawn', token: 'a', order: 0 },
  { id: 'pfood', name: 'Path to Food', fromZoneId: 'lawn', toZoneId: 'food', token: 'b', order: 1 },
  { id: 'pstage', name: 'Stage Entrance', fromZoneId: 'lawn', toZoneId: 'stage', token: 'c', order: 2 },
  { id: 'pvendor', name: 'Vendor Walkway', fromZoneId: 'lawn', toZoneId: 'vendor', token: 'd', order: 3 },
]

/** Replay a plan the way the dashboard replays the real tap log. */
function replay(plan: ReturnType<typeof planFestival>, upToMin = SPAN_MIN) {
  const dest: Record<string, string> = { pfood: 'food', pstage: 'stage', pvendor: 'vendor' }
  const occ: Record<string, number> = { lawn: 0, food: 0, stage: 0, vendor: 0 }
  let onSite = 0
  let attendance = 0
  for (const t of plan.taps) {
    if (t.m > upToMin) break
    if (t.checkpointId === 'gate') {
      const d = t.direction === 'in' ? 1 : -1
      occ.lawn += d
      onSite += d
      if (d === 1) attendance++
    } else {
      const d = t.direction === 'in' ? 1 : -1
      occ[dest[t.checkpointId]] += d
      occ.lawn -= d
    }
  }
  return { occ, onSite, attendance }
}

describe('the generated festival', () => {
  const plan = planFestival(zones, checkpoints)

  it('is the same festival every time, so the demo tells one story', () => {
    const again = planFestival(zones, checkpoints)
    expect(again.taps.length).toBe(plan.taps.length)
    expect(again.taps[1000]).toEqual(plan.taps[1000])
  })

  it('splits into history written at once and a tail played out live', () => {
    expect(plan.history.length + plan.live.length).toBe(plan.taps.length)
    expect(plan.history.every((t) => t.m <= HISTORY_MIN)).toBe(true)
    expect(plan.live.every((t) => t.m > HISTORY_MIN)).toBe(true)
    expect(plan.live.length).toBeGreaterThan(100)
  })

  it('is in chronological order, because it is written that way', () => {
    for (let i = 1; i < plan.taps.length; i++) {
      expect(plan.taps[i].m).toBeGreaterThanOrEqual(plan.taps[i - 1].m)
    }
  })

  it('never strands people: no zone ever holds a negative number', () => {
    for (let m = 5; m <= SPAN_MIN; m += 5) {
      const { occ } = replay(plan, m)
      for (const [zone, n] of Object.entries(occ)) {
        expect(n, `${zone} at minute ${m}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('never holds more people in one area than are on the whole site', () => {
    for (let m = 5; m <= SPAN_MIN; m += 5) {
      const { occ, onSite } = replay(plan, m)
      expect(Math.max(...Object.values(occ))).toBeLessThanOrEqual(onSite)
    }
  })

  it('starts slow, surges at the entrance around minute 40, and fills up', () => {
    const early = replay(plan, 20).onSite
    const surge = replay(plan, 55).onSite - replay(plan, 30).onSite
    const calm = replay(plan, 30).onSite - replay(plan, 5).onSite
    expect(early).toBeLessThan(150)
    expect(surge).toBeGreaterThan(calm * 2)
    expect(replay(plan, SPAN_MIN).onSite).toBeGreaterThan(1200)
  })

  it('drives the stage over its capacity alert during the live tail, not before', () => {
    const atHandover = replay(plan, HISTORY_MIN).occ.stage / 1200
    const atEnd = replay(plan, SPAN_MIN).occ.stage / 1200
    expect(atHandover).toBeLessThan(0.85)
    expect(atEnd).toBeGreaterThan(0.85)
  })

  it('fills the food court through the middle of the evening', () => {
    expect(replay(plan, 115).occ.food / 800).toBeGreaterThan(0.4)
  })

  it('stops one checkpoint mid-event and kills another for good', () => {
    expect(plan.silences).toHaveLength(2)
    const [midEvent, lateDead] = plan.silences
    expect(midEvent.toMin - midEvent.fromMin).toBe(6)
    expect(lateDead.toMin).toBe(SPAN_MIN)

    for (const silence of plan.silences) {
      const during = plan.taps.filter(
        (t) =>
          t.checkpointId === silence.checkpointId &&
          t.m >= silence.fromMin &&
          t.m < silence.toMin,
      )
      expect(during).toHaveLength(0)
    }
  })

  it('leaves the dead checkpoint quiet for long enough to show on the dashboard', () => {
    const lateDead = plan.silences[1]
    // It must already look dead the moment the history lands, not five minutes later.
    expect(HISTORY_MIN - lateDead.fromMin).toBeGreaterThanOrEqual(5)
  })

  it('raises two flags for the organizer to deal with', () => {
    expect(plan.flags).toHaveLength(2)
    expect(plan.flags.map((f) => f.type)).toEqual(['long_line', 'needs_staff'])
  })

  it('costs a predictable number of writes, since every tap is one', () => {
    expect(plan.taps.length).toBeGreaterThan(4000)
    expect(plan.taps.length).toBeLessThan(8000)
  })
})

describe('scale', () => {
  it('shrinks the crowd without changing how it moves', () => {
    const full = planFestival(zones, checkpoints, { scale: 1 })
    const half = planFestival(zones, checkpoints, { scale: 0.5 })
    expect(half.taps.length).toBeLessThan(full.taps.length * 0.7)

    // Same shape: the stage still takes the same share of the site at the end.
    const shareOf = (p: ReturnType<typeof planFestival>) => {
      const { occ, onSite } = replay(p)
      return occ.stage / onSite
    }
    expect(shareOf(half)).toBeCloseTo(shareOf(full), 1)
  })
})

describe('roles', () => {
  it('finds the gate and ranks the inner paths by the area behind them', () => {
    const roles = assignRoles(zones, checkpoints)
    expect(roles.gate?.id).toBe('gate')
    expect(roles.headline?.id).toBe('pstage')
    expect(roles.food?.id).toBe('pfood')
    expect(roles.browse.map((c) => c.id)).toEqual(['pvendor'])
  })

  it('reads a gate that is drawn the other way round', () => {
    const backwards: Checkpoint[] = [
      { id: 'exit', name: 'Gate', fromZoneId: 'lawn', toZoneId: OUTSIDE, token: 'a', order: 0 },
      ...checkpoints.slice(1),
    ]
    const plan = planFestival(zones, backwards)
    const onward = plan.taps.filter((t) => t.checkpointId === 'exit' && t.direction === 'out')
    const homeward = plan.taps.filter((t) => t.checkpointId === 'exit' && t.direction === 'in')
    // "out" on this checkpoint means OUTSIDE -> lawn, so it must dominate.
    expect(onward.length).toBeGreaterThan(homeward.length * 3)
  })
})
