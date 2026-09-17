import { ZoneSparkline } from './charts'
import type { ChartTheme } from './charts'
import { BAND_STYLES, band, clockLabel, percent } from '../lib/format'
import { perMinute, perMinuteLabel } from '../lib/confidence'
import type { Confidence, SilentFeeder, ZoneConfidence } from '../lib/confidence'
import type { Point } from '../lib/series'
import type { Zone } from '../types'

export type ZoneStats = {
  zone: Zone
  occupancy: number
  net10: number
  spark: Point[]
  forecast: Point[]
  minutesToCapacity: number | null
  peak: { value: number; at: number }
  dwellMin: number | null
  /** Dashboard only: how stale this zone's calibration is. */
  confidence?: ZoneConfidence
  /** Dashboard only: feeders that have stopped reporting. */
  silent?: SilentFeeder[]
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-neutral-800 text-neutral-300',
  medium: 'bg-amber-950 text-amber-300',
  low: 'bg-red-950 text-red-300',
}

/** The window the rate is measured over, in minutes. */
const RATE_WINDOW_MIN = 10

/**
 * One zone: the number, how it got here, and where it is going. The chart is a
 * single series, so it needs no legend - the card title names it - and the
 * numbers above it are the chart's table view.
 */
export function ZoneCard({
  stats,
  theme = 'dark',
  compact = false,
  showName = true,
  detail = true,
  onReset,
}: {
  stats: ZoneStats
  theme?: ChartTheme
  compact?: boolean
  /** Off on the vendor page, where the zone name is already the page heading. */
  showName?: boolean
  /** Peak and dwell. On for the report and the vendor page, off on the dashboard,
   *  where the card has to be readable at a glance in the dark. */
  detail?: boolean
  /** Organizer only: recalibrate this zone. */
  onReset?: () => void
}) {
  const { zone, occupancy, net10, spark, forecast, minutesToCapacity, peak, dwellMin } = stats
  // With a forecast the card is live and the right edge is "now"; without one
  // it is a finished window on the report, where "now" would be a lie and a
  // time-to-capacity would be meaningless.
  const live = forecast.length > 0
  const firstAt = spark.length > 0 ? clockLabel(spark[0].t) : ''
  const lastAt = spark.length > 0 ? clockLabel(spark[spark.length - 1].t) : ''
  const pct = percent(occupancy, zone.capacity)
  const styles = BAND_STYLES[band(pct)]
  const rate = perMinute(net10, RATE_WINDOW_MIN)
  const arrow = net10 > 0 ? '▲' : net10 < 0 ? '▼' : '■'

  const surface = theme === 'dark' ? 'bg-neutral-900' : 'bg-white'
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'

  return (
    <div className={`rounded-xl border-2 p-4 ${styles.bg} ${surface}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-base font-semibold ${strong}`}>
          {showName ? zone.name : ''}
        </span>
        <span className={`shrink-0 text-xl font-bold ${styles.text}`}>{pct}%</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-5xl font-black ${strong}`}>{occupancy.toLocaleString()}</span>
        <span className={`text-sm ${muted}`}>of {zone.capacity.toLocaleString()}</span>
      </div>

      <div className="mt-2">
        <ZoneSparkline
          actual={spark}
          forecast={forecast}
          capacity={zone.capacity}
          theme={theme}
          height={compact ? 64 : 84}
        />
        <div className={`mt-0.5 flex justify-between text-[10px] ${muted}`}>
          <span>{firstAt}</span>
          {live && <span>now</span>}
          <span>{live ? `${clockLabel(forecast[forecast.length - 1].t)} (proj.)` : lastAt}</span>
        </div>
      </div>

      <div className={`mt-2 text-sm font-semibold ${styles.text}`}>
        {arrow} {perMinuteLabel(rate)}
        {live && minutesToCapacity !== null && (
          <span className="ml-2 font-normal">
            · full in ~{Math.min(60, Math.round(minutesToCapacity))} min
            {minutesToCapacity > 60 ? '+' : ''}
          </span>
        )}
      </div>

      {detail && (
        <div className={`mt-1 text-xs ${muted}`}>
          peak {peak.value.toLocaleString()} at {clockLabel(peak.at)}
          {dwellMin !== null && <> · dwell ~{Math.round(dwellMin)} min (est.)</>}
        </div>
      )}

      {(stats.confidence || (stats.silent && stats.silent.length > 0) || onReset) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {stats.confidence && <ConfidenceChip confidence={stats.confidence} />}
          {stats.silent && stats.silent.length > 0 && <SilentChip silent={stats.silent} />}
          {onReset && (
            <button
              onClick={onReset}
              className="ml-auto rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-300"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Time since this zone's count was last known to be right. Not a measurement of
 * the error - if we could measure it we would correct it - so the tooltip says
 * what it actually is.
 */
function ConfidenceChip({ confidence }: { confidence: ZoneConfidence }) {
  const mins = Math.round(confidence.minutesSince)
  const from = confidence.fromReset ? 'the last reset' : 'the first tap of the event'
  return (
    <span
      title={`Confidence is time since calibration, not a measured error. It has been ${mins} min since ${from}; the count drifts further from the truth the longer that is. Reset the zone when it visibly empties to restore it.`}
      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
        CONFIDENCE_STYLES[confidence.level]
      }`}
    >
      {/* Only the level is upper-cased. "164M" in a row of capitals reads as
          164 million, which on a crowd dashboard is not a harmless misreading. */}
      <span className="tracking-wide uppercase">{confidence.level}</span> confidence ·{' '}
      {mins} min
    </span>
  )
}

/** A dead phone, shown on the zone whose number it is quietly corrupting. */
function SilentChip({ silent }: { silent: SilentFeeder[] }) {
  const first = silent[0]
  const detail = first.everReported
    ? `${first.checkpoint.name} stopped reporting at ${clockLabel(first.since)}`
    : `${first.checkpoint.name} has not reported since the event started`
  const more = silent.length > 1 ? ` (+${silent.length - 1} more)` : ''
  return (
    <span
      title={`${detail}${more}. While a checkpoint is quiet this zone stops changing and looks calmer than it is.`}
      className="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
    >
      ⚠ {detail}
      {more}
    </span>
  )
}
