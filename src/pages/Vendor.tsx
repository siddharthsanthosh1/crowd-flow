import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useAllTaps, useEventConfig } from '../lib/data'
import { useNow } from '../lib/useNow'
import { computeNetChange, computeOccupancy, minutesToCapacity } from '../lib/occupancy'
import {
  dwellMinutes,
  forecastLine,
  projectedOccupancy,
  replayZones,
  zoneArrivalRate,
} from '../lib/series'
import { FORECAST_HORIZON_MIN } from '../lib/forecastLog'
import { band, percent } from '../lib/format'
import { Screen } from '../components/Screen'
import { ZoneCard } from '../components/ZoneCard'

const MINUTE = 60_000
const TREND_WINDOW_MIN = 10
const SPARK_WINDOW_MIN = 60
const CHART_TICK_MS = 15_000

const PLAIN_STATUS = {
  green: 'Comfortable',
  yellow: 'Busy',
  red: 'Very busy',
} as const

/**
 * A single zone, read-only, for a food vendor or stage manager who wants to know
 * whether a rush is coming. No flags, no controls, nothing about other zones.
 */
export function Vendor() {
  const { eventId, zoneId } = useParams<{ eventId: string; zoneId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, resets, loading, notFound } = useEventConfig(eventId, uid)
  const { taps } = useAllTaps(eventId, uid)

  const now = useNow(1000)
  const chartNow = Math.floor(now / CHART_TICK_MS) * CHART_TICK_MS

  const zone = zones.find((z) => z.id === zoneId) ?? null
  const zoneList = useMemo(() => (zone ? [zone] : []), [zone])

  const occupancy = useMemo(
    () => computeOccupancy(zoneList, checkpoints, taps, resets, now),
    [zoneList, checkpoints, taps, resets, now],
  )
  const trend = useMemo(
    () => computeNetChange(zoneList, checkpoints, taps, now - TREND_WINDOW_MIN * MINUTE, now),
    [zoneList, checkpoints, taps, now],
  )
  const series = useMemo(
    () =>
      replayZones(
        zoneList,
        checkpoints,
        taps,
        resets,
        chartNow - SPARK_WINDOW_MIN * MINUTE,
        chartNow,
        MINUTE,
      ),
    [zoneList, checkpoints, taps, resets, chartNow],
  )
  const arrivalRate = useMemo(
    () => zoneArrivalRate(zoneList, checkpoints, taps, chartNow - SPARK_WINDOW_MIN * MINUTE, chartNow),
    [zoneList, checkpoints, taps, chartNow],
  )

  if (loading) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" />
  if (!zone) return <Screen title="Area not found" />

  const current = occupancy.get(zone.id) ?? 0
  const net10 = trend.get(zone.id) ?? 0
  const points = series.get(zone.id)?.points ?? []
  const last = points.at(-1) ?? { t: chartNow, v: current }
  const pct = percent(current, zone.capacity)
  const projected = projectedOccupancy(current, net10, TREND_WINDOW_MIN, FORECAST_HORIZON_MIN)

  return (
    <div className="mx-auto min-h-[100svh] max-w-md bg-neutral-950 p-3 text-neutral-100">
      <header className="mb-3">
        <h1 className="text-lg font-bold">{zone.name}</h1>
        <p className="text-xs text-neutral-500">{event?.name}</p>
      </header>

      <p className="mb-3 text-2xl font-bold">
        {PLAIN_STATUS[band(pct)]}
        <span className="ml-2 text-base font-normal text-neutral-400">
          {net10 > 0 ? 'and filling' : net10 < 0 ? 'and emptying' : 'and steady'}
        </span>
      </p>

      <ZoneCard
        stats={{
          zone,
          occupancy: current,
          net10,
          spark: points,
          forecast: forecastLine(last, net10, TREND_WINDOW_MIN, FORECAST_HORIZON_MIN, MINUTE),
          minutesToCapacity: minutesToCapacity(current, zone.capacity, net10, TREND_WINDOW_MIN),
          peak: series.get(zone.id)?.peak ?? { value: current, at: chartNow },
          dwellMin: dwellMinutes(current, arrivalRate.get(zone.id) ?? 0),
        }}
      />

      <p className="mt-3 text-sm text-neutral-400">
        In {FORECAST_HORIZON_MIN} minutes, expect around{' '}
        <span className="font-bold text-neutral-100">{projected.toLocaleString()}</span> people
        here if the current rate holds.
      </p>
      <p className="mt-4 text-xs text-neutral-600">
        Counts are estimates from volunteers tapping at each entrance. Updates automatically.
      </p>
    </div>
  )
}
