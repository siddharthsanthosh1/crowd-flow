import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import {
  useActions,
  useAllTaps,
  useEventConfig,
  useFlags,
  useForecasts,
  useSiteMap,
} from '../lib/data'
import { useNow } from '../lib/useNow'
import { useAdminAccess } from '../lib/useAdminAccess'
import { acknowledgeFlag, resetZone } from '../lib/admin'
import { computeNetChange, computeOccupancy, lastTapByCheckpoint, minutesToCapacity } from '../lib/occupancy'
import {
  checkpointThroughput,
  dwellMinutes,
  forecastLine,
  projectedOccupancy,
  replayZones,
  siteFlow,
  zoneArrivalRate,
} from '../lib/series'
import {
  FORECAST_HORIZON_MIN,
  FORECAST_INTERVAL_MS,
  MIN_SCORED_FOR_ACCURACY,
  accuracyOf,
  accuracyPctOf,
  dueForResolution,
  forecastDocId,
  recordForecast,
  resolveForecast,
} from '../lib/forecastLog'
import { silentFeeders, watchZone, zoneConfidence } from '../lib/confidence'
import { buildOpsLog, BUSY_PCT } from '../lib/opsLog'
import { band, percent } from '../lib/format'
import { OUTSIDE } from '../types'
import type { FlagType } from '../types'
import { Screen } from '../components/Screen'
import { ZoneCard } from '../components/ZoneCard'
import { SiteMap } from '../components/SiteMap'
import type { ZoneStats } from '../components/ZoneCard'
import { ArrivalsChart, ThroughputChart } from '../components/charts'
import {
  AlertBanner,
  CheckpointHealth,
  CollapsibleSection,
  FlowTable,
  HeaderLock,
  MoreDrawer,
  OpsLogList,
  ResetDialog,
  Section,
  SimulatedBadge,
  StatTile,
} from '../components/sections'
import type { ZoneAlert } from '../components/sections'

const TREND_WINDOW_MIN = 10
const SPARK_WINDOW_MIN = 60
const FLOW_WINDOW_MIN = 15
const THROUGHPUT_WINDOW_MIN = 10
const MINUTE = 60_000
const EVENT_BUCKET_MIN = 5
const EVENT_BUCKET_MS = EVENT_BUCKET_MIN * MINUTE

const AMBER_SILENCE_MS = 120_000
const RED_SILENCE_MS = 300_000

/** Charts do not need to redraw every second, and on a phone they should not. */
const CHART_TICK_MS = 15_000

/** A dismissed alert comes back after this long, or sooner if a new zone joins it. */
const ALERT_SNOOZE_MS = 10 * MINUTE

const FLAG_LABELS: Record<FlagType, string> = {
  long_line: 'Long line',
  hazard: 'Spill or hazard',
  needs_staff: 'Needs staff',
  medical: 'Medical',
}

export function Dashboard() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, resets, loading, notFound } = useEventConfig(eventId, uid)
  const { taps } = useAllTaps(eventId, uid)
  const { flags } = useFlags(eventId, uid)
  const { forecasts, loaded: forecastsLoaded } = useForecasts(eventId, uid)
  const { actions } = useActions(eventId, uid)
  const { siteMap } = useSiteMap(eventId, uid)
  const { status: adminStatus, error: adminError, unlock } = useAdminAccess(eventId, uid)
  const isAdmin = adminStatus === 'yes'
  const wide = useWideScreen()

  const now = useNow(1000)
  const chartTick = Math.floor(now / CHART_TICK_MS)
  const [soundOn, setSoundOn] = useState(false)
  const [snooze, setSnooze] = useState<{ until: number; zoneIds: string[] } | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)

  // ---- live numbers, cheap enough to recompute every second ---------------
  const occupancy = useMemo(
    () => computeOccupancy(zones, checkpoints, taps, resets, now),
    [zones, checkpoints, taps, resets, now],
  )
  const trend = useMemo(
    () => computeNetChange(zones, checkpoints, taps, now - TREND_WINDOW_MIN * MINUTE, now),
    [zones, checkpoints, taps, now],
  )
  const lastTap = useMemo(() => lastTapByCheckpoint(taps), [taps])

  // ---- chart data, recomputed on the slower tick --------------------------
  const chartNow = chartTick * CHART_TICK_MS

  const zoneSeries = useMemo(
    () =>
      replayZones(
        zones,
        checkpoints,
        taps,
        resets,
        chartNow - SPARK_WINDOW_MIN * MINUTE,
        chartNow,
        MINUTE,
      ),
    [zones, checkpoints, taps, resets, chartNow],
  )

  const eventStart = useMemo(() => {
    const first = taps.find((t) => !t.undone)
    if (!first) return chartNow - 60 * MINUTE
    return Math.floor(first.clientTs.toMillis() / EVENT_BUCKET_MS) * EVENT_BUCKET_MS
  }, [taps, chartNow])

  const site = useMemo(
    () => siteFlow(checkpoints, taps, eventStart, chartNow, EVENT_BUCKET_MS),
    [checkpoints, taps, eventStart, chartNow],
  )

  const throughput = useMemo(
    () => checkpointThroughput(checkpoints, taps, chartNow - THROUGHPUT_WINDOW_MIN * MINUTE, chartNow),
    [checkpoints, taps, chartNow],
  )
  const flowRows = useMemo(
    () => checkpointThroughput(checkpoints, taps, chartNow - FLOW_WINDOW_MIN * MINUTE, chartNow),
    [checkpoints, taps, chartNow],
  )
  const arrivalRate = useMemo(
    () => zoneArrivalRate(zones, checkpoints, taps, chartNow - SPARK_WINDOW_MIN * MINUTE, chartNow),
    [zones, checkpoints, taps, chartNow],
  )

  /** Fullest first: whatever is closest to being a problem is the first card. */
  const zoneStats: ZoneStats[] = useMemo(
    () =>
      zones
        .map((zone) => {
          const series = zoneSeries.get(zone.id)
          const points = series?.points ?? []
          const current = occupancy.get(zone.id) ?? 0
          const net10 = trend.get(zone.id) ?? 0
          const last = points.at(-1) ?? { t: chartNow, v: current }
          return {
            zone,
            occupancy: current,
            net10,
            spark: points,
            forecast: forecastLine(last, net10, TREND_WINDOW_MIN, FORECAST_HORIZON_MIN, MINUTE),
            minutesToCapacity: minutesToCapacity(current, zone.capacity, net10, TREND_WINDOW_MIN),
            peak: series?.peak ?? { value: current, at: chartNow },
            dwellMin: dwellMinutes(current, arrivalRate.get(zone.id) ?? 0),
            confidence: zoneConfidence(zone.id, eventStart, resets, now),
            silent: silentFeeders(zone.id, checkpoints, lastTap, eventStart, now),
          }
        })
        .sort(
          (a, b) =>
            percent(b.occupancy, b.zone.capacity) - percent(a.occupancy, a.zone.capacity),
        ),
    [
      zones,
      zoneSeries,
      occupancy,
      trend,
      arrivalRate,
      chartNow,
      eventStart,
      resets,
      checkpoints,
      lastTap,
      now,
    ],
  )

  const accuracy = useMemo(() => accuracyOf(forecasts), [forecasts])
  const accuracyPct = useMemo(() => accuracyPctOf(zones, forecasts), [zones, forecasts])

  const opsLog = useMemo(
    () =>
      buildOpsLog({
        zones,
        series: zoneSeries,
        flags,
        resets,
        forecasts,
        checkpointName: (id) => checkpoints.find((c) => c.id === id)?.name ?? 'Unknown checkpoint',
      }),
    [zones, zoneSeries, flags, resets, forecasts, checkpoints],
  )

  const alerts: ZoneAlert[] = useMemo(
    () =>
      zoneStats
        .map((s) => ({
          zone: s.zone,
          pct: percent(s.occupancy, s.zone.capacity),
          minutesToCapacity: s.minutesToCapacity,
        }))
        .filter((a) => a.pct > BUSY_PCT || (a.minutesToCapacity !== null && a.minutesToCapacity <= 15)),
    [zoneStats],
  )

  // A snooze covers the zones that were alerting when it was tapped. A zone that
  // starts alerting afterwards is new information and brings the banner back.
  const snoozed =
    snooze !== null &&
    now < snooze.until &&
    alerts.every((a) => snooze.zoneIds.includes(a.zone.id))
  const visibleAlerts = snoozed ? [] : alerts

  useAlertChime(visibleAlerts.length, soundOn)
  useForecastLogging({ eventId, isAdmin, zoneStats, taps, now, zones, checkpoints, resets, forecasts, forecastsLoaded, chartTick })

  if (loading) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" />

  const zoneName = (id: string) =>
    id === OUTSIDE ? 'Outside' : (zones.find((z) => z.id === id)?.name ?? 'Unknown')

  const quietCheckpoints = new Set(
    checkpoints
      .filter((c) => {
        const last = lastTap.get(c.id)
        return last === undefined || now - last >= AMBER_SILENCE_MS
      })
      .map((c) => c.id),
  )

  const openFlags = flags.filter((f) => !f.acknowledged)

  // The strip's four answers, in the order an organizer needs them.
  const attendance = site.at(-1)?.cumulativeArrivals ?? 0
  const onSite = [...occupancy.values()].reduce((a, b) => a + b, 0)
  const watch = watchZone(
    zoneStats.map((s) => ({
      zone: s.zone,
      pct: percent(s.occupancy, s.zone.capacity),
      minutesToCapacity: s.minutesToCapacity,
    })),
  )
  const resettingZone = zones.find((z) => z.id === resetting)

  return (
    <div className="mx-auto min-h-[100svh] max-w-5xl bg-neutral-950 p-3 pb-16 text-neutral-100">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="truncate text-xl font-bold">{event?.name}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Link to={`/report/${eventId}`} className="text-xs text-neutral-400 underline">
            report
          </Link>
          <HeaderLock isAdmin={isAdmin} error={adminError} onUnlock={unlock} />
        </div>
      </header>

      {event?.demo && <SimulatedBadge />}

      {/* 1. How many people are here. 2. What is about to be a problem.
          3. Whether the numbers can still be trusted. */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label="Attendance so far"
          value={attendance.toLocaleString()}
          sub="everyone who has come in"
          emphasis
        />
        <StatTile label="On site now" value={onSite.toLocaleString()} sub="across all areas" />
        <StatTile
          label="Watch"
          value={watch ? `${watch.pct}%` : 'Steady'}
          sub={
            watch
              ? `${watch.zone.name} · full in ~${Math.min(60, Math.round(watch.minutesToCapacity as number))} min`
              : 'All zones steady'
          }
          tone={watch ? band(watch.pct) : undefined}
        />
        <StatTile
          label="Forecast accuracy"
          value={accuracyPct.mae === null ? '—' : `±${accuracyPct.mae.toFixed(0)}%`}
          sub={
            accuracyPct.mae === null
              ? `${accuracyPct.count} of ${MIN_SCORED_FOR_ACCURACY} scored`
              : `${accuracyPct.count} scored · of capacity`
          }
        />
      </div>

      <AlertBanner
        alerts={visibleAlerts}
        actions={actions}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn((v) => !v)}
        onDismiss={() =>
          setSnooze({ until: Date.now() + ALERT_SNOOZE_MS, zoneIds: alerts.map((a) => a.zone.id) })
        }
      />

      <Section
        title="Zones"
        note={`Fullest first. Last ${SPARK_WINDOW_MIN} minutes, with the next ${FORECAST_HORIZON_MIN} projected (dashed).`}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {zoneStats.map((stats) => (
            <ZoneCard
              key={stats.zone.id}
              stats={stats}
              detail={false}
              onReset={isAdmin ? () => setResetting(stats.zone.id) : undefined}
            />
          ))}
        </div>
        {zones.length === 0 && (
          <p className="text-neutral-400">No zones yet. Set them up on the admin page.</p>
        )}
      </Section>

      {/* Directly under the cards: a quiet checkpoint is the reason a number
          above is wrong, so the two are read together. */}
      <Section title="Checkpoint health" note="A quiet checkpoint means the counts above are drifting.">
        <CheckpointHealth
          checkpoints={checkpoints}
          lastTap={lastTap}
          now={now}
          zoneName={zoneName}
          amberMs={AMBER_SILENCE_MS}
          redMs={RED_SILENCE_MS}
        />
      </Section>

      {openFlags.length > 0 && (
        <Section title="Unacknowledged flags">
          <div className="grid gap-2">
            {openFlags.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-lg border-2 border-amber-500 bg-amber-950 p-3"
              >
                <div className="min-w-0">
                  <div className="font-bold text-amber-200">{FLAG_LABELS[f.type]}</div>
                  <div className="truncate text-xs text-amber-400/80">
                    {checkpoints.find((c) => c.id === f.checkpointId)?.name ?? 'Unknown'}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => eventId && acknowledgeFlag(eventId, f.id)}
                    className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 font-bold text-white"
                  >
                    Got it
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <CollapsibleSection
        title="Arrivals and attendance"
        note={`Bars are people entering the site per ${EVENT_BUCKET_MIN} minutes; the line is everyone who has come in.`}
        openByDefault={wide}
      >
        <ArrivalsChart data={site} bucketMinutes={EVENT_BUCKET_MIN} />
      </CollapsibleSection>

      {siteMap && (
        <CollapsibleSection
          title="Site map"
          note="Circle size and colour follow how full each area is."
          openByDefault={wide}
        >
          <SiteMap imageUrl={siteMap} zones={zones} occupancy={occupancy} />
        </CollapsibleSection>
      )}

      <MoreDrawer>
        <Section
          title="Checkpoint throughput"
          note={`People per minute across each point, last ${THROUGHPUT_WINDOW_MIN} minutes. Red means the checkpoint has gone quiet.`}
        >
          <ThroughputChart
            data={checkpoints.map((c) => ({
              id: c.id,
              name: c.name,
              perMinute: throughput.find((t) => t.checkpointId === c.id)?.perMinute ?? 0,
            }))}
            quietIds={quietCheckpoints}
          />
        </Section>

        <Section title={`Flow, last ${FLOW_WINDOW_MIN} minutes`}>
          <FlowTable checkpoints={checkpoints} throughput={flowRows} zoneName={zoneName} />
        </Section>

        <Section
          title="Forecast accuracy in detail"
          note={`Every ${FORECAST_INTERVAL_MS / MINUTE} minutes each zone's ${FORECAST_HORIZON_MIN}-minute forecast is recorded, then scored against what actually happened.`}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile
              label="Mean absolute error"
              value={accuracy.mae === null ? '—' : accuracy.mae.toFixed(1)}
              sub={accuracy.mae === null ? 'nothing scored yet' : 'people, per forecast'}
            />
            <StatTile
              label="Bias"
              value={
                accuracy.bias === null
                  ? '—'
                  : `${accuracy.bias > 0 ? '+' : ''}${accuracy.bias.toFixed(1)}`
              }
              sub={accuracy.bias === null ? '' : accuracy.bias > 0 ? 'runs high' : 'runs low'}
            />
            <StatTile label="Scored" value={String(accuracy.count)} sub="forecasts" />
          </div>
          {!isAdmin && (
            <p className="mt-2 text-xs text-neutral-500">
              Forecasts are recorded by the organizer's dashboard. Unlock this device with the
              lock in the header to record them here.
            </p>
          )}
        </Section>

        <Section title="Operations log" note="Alerts, flags, resets and forecast outcomes.">
          <OpsLogList entries={opsLog} />
        </Section>
      </MoreDrawer>

      {resettingZone && (
        <ResetDialog
          zoneName={resettingZone.name}
          onCancel={() => setResetting(null)}
          onConfirm={(count, note) => {
            resetZone(eventId!, resettingZone.id, count, note || 'Reset from dashboard').catch(
              console.error,
            )
            setResetting(null)
          }}
        />
      )}
    </div>
  )
}

/** Desktop has room to leave the chart open; a phone does not. */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/**
 * Record what the dashboard predicted, and later score it. Both are organizer
 * actions because they write to the event.
 */
function useForecastLogging({
  eventId,
  isAdmin,
  zoneStats,
  taps,
  zones,
  checkpoints,
  resets,
  forecasts,
  forecastsLoaded,
  now,
  chartTick,
}: {
  eventId: string | undefined
  isAdmin: boolean
  zoneStats: ZoneStats[]
  taps: import('../types').Tap[]
  zones: import('../types').Zone[]
  checkpoints: import('../types').Checkpoint[]
  resets: import('../types').Reset[]
  forecasts: import('../types').Forecast[]
  forecastsLoaded: boolean
  now: number
  chartTick: number
}) {
  const loggedBucket = useRef<number | null>(null)
  const resolving = useRef(new Set<string>())

  const bucket = Math.floor(now / FORECAST_INTERVAL_MS)
  const hasTaps = taps.some((t) => !t.undone)

  useEffect(() => {
    if (!eventId || !isAdmin || !hasTaps || !forecastsLoaded || zoneStats.length === 0) return
    if (loggedBucket.current === bucket) return
    loggedBucket.current = bucket

    const madeAtMs = bucket * FORECAST_INTERVAL_MS
    const alreadyLogged = new Set(forecasts.map((f) => f.id))

    for (const stats of zoneStats) {
      // Forecast ids are deterministic, so a second dashboard open on the same
      // event would rewrite this interval's document - and the rules only allow
      // a forecast to be created once and scored once, never rewritten. Left
      // alone that is a permission error on every organizer's spare tablet,
      // every two minutes, for the whole evening.
      if (alreadyLogged.has(forecastDocId(stats.zone.id, madeAtMs))) continue

      const predicted = projectedOccupancy(
        stats.occupancy,
        stats.net10,
        TREND_WINDOW_MIN,
        FORECAST_HORIZON_MIN,
      )
      recordForecast(eventId, stats.zone.id, madeAtMs, predicted).catch((e) => {
        // Two dashboards can still start inside the same interval and race for
        // the document. The loser is told no, which is the right answer - the
        // forecast is on record either way - so it is not worth shouting about.
        if ((e as { code?: string }).code !== 'permission-denied') {
          console.error('forecast not recorded', e)
        }
      })
    }
  }, [eventId, isAdmin, hasTaps, forecastsLoaded, bucket, zoneStats, forecasts])

  useEffect(() => {
    if (!eventId || !isAdmin) return
    for (const forecast of dueForResolution(forecasts, Date.now())) {
      if (resolving.current.has(forecast.id)) continue
      resolving.current.add(forecast.id)
      const actual = computeOccupancy(
        zones,
        checkpoints,
        taps,
        resets,
        forecast.targetTime.toMillis(),
      ).get(forecast.zoneId)
      if (actual === undefined) continue
      resolveForecast(eventId, forecast.id, actual).catch((e) =>
        console.error('forecast not scored', e),
      )
    }
  }, [eventId, isAdmin, forecasts, zones, checkpoints, taps, resets, chartTick])
}

/** A short chime when a new zone starts needing attention, if the user asked for it. */
function useAlertChime(alertCount: number, soundOn: boolean) {
  const previous = useRef(0)
  useEffect(() => {
    const rising = alertCount > previous.current
    previous.current = alertCount
    if (!rising || !soundOn) return
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.5)
      osc.onended = () => void ctx.close()
    } catch {
      /* audio is a convenience, never a requirement */
    }
  }, [alertCount, soundOn])
}
