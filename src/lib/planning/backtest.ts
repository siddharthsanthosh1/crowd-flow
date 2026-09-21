import { Timestamp } from 'firebase/firestore'
import { OUTSIDE } from '../../types'
import type { Checkpoint, Tap, Zone } from '../../types'
import { planFestival, SPAN_MIN } from '../simulate'
import { computeNetChange, computeOccupancy } from '../occupancy'
import { projectedOccupancy, replayZones } from '../series'
import { FORECAST_HORIZON_MIN, FORECAST_INTERVAL_MS } from '../forecastLog'
import { holtForecast } from './holt'

/**
 * Score both forecasters on a simulated evening, exactly as the dashboard would
 * have: every 2 minutes, each zone's 15-minute forecast from the data up to
 * then, compared with the count 15 minutes later.
 *
 * This replays the whole evening offline. Live, forecasts are only scored in
 * real time with a dashboard left open, so a full three-hour comparison is
 * only practical this way.
 */
const MINUTE = 60_000
const TREND_WINDOW_MIN = 10
const SPARK_WINDOW_MIN = 60

/** The demo event's layout, as createDemoEvent builds it. */
export const DEMO_ZONES: Zone[] = [
  { id: 'lawn', name: 'Main Lawn', capacity: 2500, order: 0 },
  { id: 'food', name: 'Food Court', capacity: 800, order: 1 },
  { id: 'stage', name: 'Stage Seating', capacity: 1200, order: 2 },
  { id: 'vendor', name: 'Vendor Row', capacity: 600, order: 3 },
]
export const DEMO_CHECKPOINTS: Checkpoint[] = [
  { id: 'gate', name: 'Gate A', fromZoneId: OUTSIDE, toZoneId: 'lawn', token: 'a', order: 0 },
  { id: 'food', name: 'Path to Food Court', fromZoneId: 'lawn', toZoneId: 'food', token: 'b', order: 1 },
  { id: 'stage', name: 'Stage Entrance', fromZoneId: 'lawn', toZoneId: 'stage', token: 'c', order: 2 },
  { id: 'vendor', name: 'Vendor Row Walkway', fromZoneId: 'lawn', toZoneId: 'vendor', token: 'd', order: 3 },
]

export type BacktestResult = { seed: number; count: number; linearMae: number; holtMae: number }

export function backtest(seed: number, scale = 1): BacktestResult {
  const plan = planFestival(DEMO_ZONES, DEMO_CHECKPOINTS, { seed, scale })
  const taps: Tap[] = plan.taps.map((t, i) => ({
    id: String(i),
    checkpointId: t.checkpointId,
    direction: t.direction,
    clientTs: Timestamp.fromMillis(t.m * MINUTE),
    serverTs: null,
    deviceId: 'sim',
    undone: false,
  }))

  let linear = 0
  let holt = 0
  let count = 0
  const step = FORECAST_INTERVAL_MS / MINUTE
  for (let m = TREND_WINDOW_MIN; m + FORECAST_HORIZON_MIN <= SPAN_MIN; m += step) {
    const now = m * MINUTE
    const occ = computeOccupancy(DEMO_ZONES, DEMO_CHECKPOINTS, taps, [], now)
    const net = computeNetChange(DEMO_ZONES, DEMO_CHECKPOINTS, taps, now - TREND_WINDOW_MIN * MINUTE, now)
    const series = replayZones(DEMO_ZONES, DEMO_CHECKPOINTS, taps, [], Math.max(0, now - SPARK_WINDOW_MIN * MINUTE), now, MINUTE)
    const actual = computeOccupancy(DEMO_ZONES, DEMO_CHECKPOINTS, taps, [], now + FORECAST_HORIZON_MIN * MINUTE)
    for (const z of DEMO_ZONES) {
      const a = actual.get(z.id) ?? 0
      const lin = projectedOccupancy(occ.get(z.id) ?? 0, net.get(z.id) ?? 0, TREND_WINDOW_MIN, FORECAST_HORIZON_MIN)
      const values = series.get(z.id)!.points.map((p) => p.v)
      const h = Math.round(holtForecast(values, FORECAST_HORIZON_MIN))
      linear += Math.abs(lin - a)
      holt += Math.abs(h - a)
      count++
    }
  }
  return { seed, count, linearMae: linear / count, holtMae: holt / count }
}
