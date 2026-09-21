/**
 * Holt's double exponential smoothing with a damped trend - the second
 * forecaster, run beside the straight-line one and scored the same way.
 *
 * It keeps a smoothed level and a smoothed trend, and when it looks ahead it
 * lets the trend fade (by φ each minute) instead of running it on forever the
 * way a straight line does. Parameters are fixed in advance, not tuned to the
 * simulator, so its score on simulated evenings is a fair one.
 */
export const HOLT_ALPHA = 0.5
export const HOLT_BETA = 0.2
export const HOLT_PHI = 0.9

export type HoltParams = { alpha: number; beta: number; phi: number }
export const HOLT_DEFAULTS: HoltParams = { alpha: HOLT_ALPHA, beta: HOLT_BETA, phi: HOLT_PHI }

/**
 * Forecast `horizon` steps past the last value of `series` (evenly spaced,
 * one step per minute on the dashboard). Never negative: it is a head count.
 */
export function holtForecast(
  series: number[],
  horizon: number,
  { alpha, beta, phi }: HoltParams = HOLT_DEFAULTS,
): number {
  if (series.length === 0) return 0
  if (series.length === 1) return Math.max(0, series[0])
  let level = series[0]
  let trend = series[1] - series[0]
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level
    level = alpha * series[i] + (1 - alpha) * (prevLevel + phi * trend)
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend
  }
  let damp = 0
  let f = 1
  for (let h = 1; h <= horizon; h++) {
    f *= phi
    damp += f
  }
  return Math.max(0, level + damp * trend)
}
