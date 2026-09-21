import { describe, expect, it } from 'vitest'
import { erlangC, mmc } from './erlang'

describe('erlangC against published values', () => {
  it('M/M/1: P(wait) equals utilisation', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 10)
    expect(erlangC(1, 0.8)).toBeCloseTo(0.8, 10)
  })

  it('M/M/2 at ρ = 0.5: P(wait) = 1/3', () => {
    // Textbook closed form for two servers: C = 2ρ² / (1 + ρ).
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 10)
  })

  it('3 servers, 2 erlangs: P(wait) = 4/9', () => {
    expect(erlangC(3, 2)).toBeCloseTo(4 / 9, 10)
  })

  it('call-centre table: 10 erlangs over 11-14 agents', () => {
    // Standard Erlang C table values, to 4 places.
    expect(erlangC(11, 10)).toBeCloseTo(0.6821, 4)
    expect(erlangC(12, 10)).toBeCloseTo(0.4494, 4)
    expect(erlangC(13, 10)).toBeCloseTo(0.2853, 4)
    expect(erlangC(14, 10)).toBeCloseTo(0.1741, 4)
  })

  it('is 1 once the offered load reaches the number of servers', () => {
    expect(erlangC(3, 3)).toBe(1)
    expect(erlangC(3, 5)).toBe(1)
  })
})

describe('mmc waits', () => {
  it('M/M/1: Wq = ρ / (μ − λ)', () => {
    const r = mmc(0.8, 1, 1)
    expect(r.growing).toBe(false)
    if (!r.growing) expect(r.wq).toBeCloseTo(0.8 / 0.2, 10)
  })

  it('M/M/2 at λ = μ = 1: Wq = 1/3', () => {
    const r = mmc(1, 1, 2)
    if (r.growing) throw new Error('should be stable')
    expect(r.wq).toBeCloseTo(1 / 3, 10)
  })

  it('reports a growing line, not a number, at ρ ≥ 1', () => {
    expect(mmc(2, 1, 2).growing).toBe(true)
    expect(mmc(3, 1, 2).growing).toBe(true)
  })

  it('no arrivals, no wait', () => {
    const r = mmc(0, 1, 3)
    if (r.growing) throw new Error('should be stable')
    expect(r.wq).toBe(0)
  })
})
