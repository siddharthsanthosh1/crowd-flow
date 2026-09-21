import { describe, expect, it } from 'vitest'
import { holtForecast } from './holt'

describe('holtForecast', () => {
  it('holds a flat series flat', () => {
    expect(holtForecast([50, 50, 50, 50, 50], 15)).toBeCloseTo(50, 10)
  })

  it('follows a trend, but damped: short of a straight line', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 10 * i)
    const f = holtForecast(rising, 15)
    expect(f).toBeGreaterThan(290)
    expect(f).toBeLessThan(290 + 150)
  })

  it('with φ = 1 and a perfect line it is the line', () => {
    const line = Array.from({ length: 20 }, (_, i) => 5 + 2 * i)
    expect(holtForecast(line, 10, { alpha: 0.5, beta: 0.2, phi: 1 })).toBeCloseTo(43 + 20, 6)
  })

  it('never predicts fewer than zero people', () => {
    expect(holtForecast([100, 80, 60, 40, 20, 5], 15)).toBe(0)
  })
})
