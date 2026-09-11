import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useAllTaps, useEventConfig, useFlags, useForecasts } from '../lib/data'
import { computeNetChange, computeOccupancy, minutesToCapacity } from '../lib/occupancy'
import {
  checkpointThroughput,
  dwellMinutes,
  replayZones,
  siteFlow,
  zoneArrivalRate,
} from '../lib/series'
import { accuracyByZone, accuracyOf } from '../lib/forecastLog'
import { buildOpsLog } from '../lib/opsLog'
import { clockLabel } from '../lib/format'
import { OUTSIDE } from '../types'
import { Screen } from '../components/Screen'
import { ZoneCard } from '../components/ZoneCard'
import { AccuracyChart, AccuracyLegend, TimeBarChart, TimeLineChart } from '../components/charts'
import { FlowTable, OpsLogList, Section, StatTile } from '../components/sections'

const MINUTE = 60_000
const BUCKET_MS = 5 * MINUTE
const TREND_WINDOW_MIN = 10

/**
 * The whole event on one printable page. Same charts as the dashboard, over the
 * full window instead of the last hour, plus how well the forecasts did.
 */
export function Report() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, resets, loading, notFound } = useEventConfig(eventId, uid)
  const { taps } = useAllTaps(eventId, uid)
  const { flags } = useFlags(eventId, uid)
  const { forecasts } = useForecasts(eventId, uid)

  const range = useMemo(() => {
    const live = taps.filter((t) => !t.undone)
    if (live.length === 0) return null
    const times = live.map((t) => t.clientTs.toMillis())
    const from = Math.floor(Math.min(...times) / BUCKET_MS) * BUCKET_MS
    const to = Math.ceil(Math.max(...times) / BUCKET_MS) * BUCKET_MS
    return { from, to: Math.max(to, from + BUCKET_MS) }
  }, [taps])

  const series = useMemo(
    () =>
      range
        ? replayZones(zones, checkpoints, taps, resets, range.from, range.to, BUCKET_MS)
        : new Map(),
    [zones, checkpoints, taps, resets, range],
  )
  const site = useMemo(
    () => (range ? siteFlow(checkpoints, taps, range.from, range.to, BUCKET_MS) : []),
    [checkpoints, taps, range],
  )
  const flowRows = useMemo(
    () => (range ? checkpointThroughput(checkpoints, taps, range.from, range.to) : []),
    [checkpoints, taps, range],
  )
  const arrivalRate = useMemo(
    () => (range ? zoneArrivalRate(zones, checkpoints, taps, range.from, range.to) : new Map()),
    [zones, checkpoints, taps, range],
  )
  const opsLog = useMemo(
    () =>
      buildOpsLog({
        zones,
        series,
        flags,
        resets,
        forecasts,
        checkpointName: (id) => checkpoints.find((c) => c.id === id)?.name ?? 'Unknown checkpoint',
      }),
    [zones, series, flags, resets, forecasts, checkpoints],
  )
  const accuracy = useMemo(() => accuracyOf(forecasts), [forecasts])
  const perZoneAccuracy = useMemo(() => accuracyByZone(zones, forecasts), [zones, forecasts])

  if (loading) return <Screen title="Loading…" />
  if (notFound || !event) return <Screen title="Event not found" />

  const zoneName = (id: string) =>
    id === OUTSIDE ? 'Outside' : (zones.find((z) => z.id === id)?.name ?? 'Unknown')

  if (!range) {
    return (
      <div className="min-h-[100svh] bg-white p-6 text-black">
        <h1 className="text-2xl font-bold">{event.name}</h1>
        <p className="mt-3 text-neutral-600">No taps were recorded for this event yet.</p>
      </div>
    )
  }

  const totalAttendance = site.at(-1)?.cumulativeArrivals ?? 0
  const peakOnSite = site.reduce(
    (best, b) => (b.onSite > best.onSite ? b : best),
    site[0] ?? { onSite: 0, t: range.from },
  )
  const busiestArrivals = site.reduce(
    (best, b) => (b.arrivals > best.arrivals ? b : best),
    site[0] ?? { arrivals: 0, t: range.from },
  )

  return (
    <div className="min-h-[100svh] bg-white text-black">
      <div className="no-print flex items-center justify-between gap-3 border-b border-neutral-300 p-3">
        <span className="text-sm text-neutral-700">Print at letter size</span>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-black px-4 py-2 font-bold text-white"
        >
          Print
        </button>
      </div>

      <div className="mx-auto max-w-3xl p-4 pb-16">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-neutral-600">
            {event.date} · {event.venue} · {clockLabel(range.from)} to {clockLabel(range.to)}
          </p>
        </header>

        <Section title="Headline" theme="light">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile theme="light" label="Total attendance" value={totalAttendance.toLocaleString()} sub="net entries through the gates" />
            <StatTile theme="light" label="Peak on site" value={peakOnSite.onSite.toLocaleString()} sub={`at ${clockLabel(peakOnSite.t)}`} />
            <StatTile theme="light" label="Busiest 5 minutes" value={busiestArrivals.arrivals.toLocaleString()} sub={`arrivals at ${clockLabel(busiestArrivals.t)}`} />
            <StatTile
              theme="light"
              label="Forecast error"
              value={accuracy.mae === null ? '—' : accuracy.mae.toFixed(1)}
              sub={accuracy.mae === null ? 'none scored' : `people, over ${accuracy.count} forecasts`}
            />
          </div>
        </Section>

        <Section title="People on site" theme="light">
          <TimeLineChart data={site} dataKey="onSite" label="on site" theme="light" height={200} />
        </Section>

        <Section title="Arrival curve" note="People entering the site, per 5 minutes." theme="light">
          <TimeBarChart data={site} dataKey="arrivals" label="arrivals" theme="light" height={200} />
        </Section>

        <Section
          title="Zones"
          note="Peak is the highest the zone reached at any moment. Dwell is an estimate from occupancy divided by arrival rate (Little's Law), not a measurement."
          theme="light"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {zones.map((zone) => {
              const zoneSeries = series.get(zone.id)
              const current = computeOccupancy(zones, checkpoints, taps, resets, range.to).get(zone.id) ?? 0
              const net10 =
                computeNetChange(zones, checkpoints, taps, range.to - TREND_WINDOW_MIN * MINUTE, range.to).get(
                  zone.id,
                ) ?? 0
              return (
                <ZoneCard
                  key={zone.id}
                  theme="light"
                  compact
                  stats={{
                    zone,
                    occupancy: current,
                    net10,
                    spark: zoneSeries?.points ?? [],
                    forecast: [],
                    minutesToCapacity: minutesToCapacity(current, zone.capacity, net10, TREND_WINDOW_MIN),
                    peak: zoneSeries?.peak ?? { value: 0, at: range.from },
                    dwellMin: dwellMinutes(current, arrivalRate.get(zone.id) ?? 0),
                  }}
                />
              )
            })}
          </div>
        </Section>

        <Section
          title="Forecast accuracy"
          note="Each forecast was recorded 15 minutes before the moment it describes, then compared with what happened. Positive bias means the forecast ran high."
          theme="light"
        >
          <div className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[340px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-600">
                  <th className="py-2 pr-2 font-semibold">Zone</th>
                  <th className="py-2 pr-2 text-right font-semibold">Scored</th>
                  <th className="py-2 pr-2 text-right font-semibold">Mean abs. error</th>
                  <th className="py-2 text-right font-semibold">Bias</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => {
                  const a = perZoneAccuracy.get(zone.id)
                  return (
                    <tr key={zone.id} className="border-b border-neutral-200">
                      <td className="py-2 pr-2 font-medium">{zone.name}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{a?.count ?? 0}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {a?.mae === null || a === undefined ? '—' : a.mae.toFixed(1)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {a?.bias === null || a === undefined
                          ? '—'
                          : `${a.bias > 0 ? '+' : ''}${a.bias.toFixed(1)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {zones.map((zone) => {
            const rows = forecasts
              .filter((f) => f.zoneId === zone.id && f.actualOccupancy !== null)
              .map((f) => ({
                t: f.targetTime.toMillis(),
                predicted: f.predictedOccupancy,
                actual: f.actualOccupancy as number,
              }))
              .sort((a, b) => a.t - b.t)
            if (rows.length < 2) return null
            return (
              <div key={zone.id} className="mb-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">{zone.name}</h3>
                  <AccuracyLegend theme="light" />
                </div>
                <AccuracyChart data={rows} theme="light" />
              </div>
            )
          })}
        </Section>

        <Section title="Flow by checkpoint" note="Whole event." theme="light">
          <FlowTable checkpoints={checkpoints} throughput={flowRows} zoneName={zoneName} theme="light" />
        </Section>

        <Section title="Operations log" theme="light">
          <OpsLogList entries={opsLog} theme="light" limit={200} />
        </Section>

        <p className="mt-8 text-xs text-neutral-500">
          Counts come from volunteers tapping at each checkpoint. Occupancy is a running
          difference, so small errors accumulate over the evening; treat these numbers as
          close estimates, not exact counts.
        </p>
      </div>
    </div>
  )
}
