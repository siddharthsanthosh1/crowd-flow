import { describe, expect, it } from 'vitest'
import { backtest } from './backtest'

describe('forecaster backtest on three simulated evenings', () => {
  it('scores both forecasters', () => {
    const results = [20261017, 1, 2].map((seed) => backtest(seed))
    for (const r of results) {
      console.log(
        `seed ${r.seed}: ${r.count} forecasts · linear MAE ${r.linearMae.toFixed(1)} · Holt MAE ${r.holtMae.toFixed(1)}`,
      )
      expect(Number.isFinite(r.linearMae) && Number.isFinite(r.holtMae)).toBe(true)
    }
  })
})
