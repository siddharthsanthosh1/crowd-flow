import { ZoneSparkline } from './charts'
import type { ChartTheme } from './charts'
import { BAND_STYLES, band, clockLabel, percent, signed } from '../lib/format'
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
}

/**
 * One zone: the number, how it got here, and where it is going. The chart is a
 * single series, so it needs no legend - the card title names it - and the
 * numbers above it are the chart's table view.
 */
export function ZoneCard({
  stats,
  theme = 'dark',
  compact = false,
}: {
  stats: ZoneStats
  theme?: ChartTheme
  compact?: boolean
}) {
  const { zone, occupancy, net10, spark, forecast, minutesToCapacity, peak, dwellMin } = stats
  const pct = percent(occupancy, zone.capacity)
  const styles = BAND_STYLES[band(pct)]
  const arrow = net10 > 0 ? '▲' : net10 < 0 ? '▼' : '■'

  const surface = theme === 'dark' ? 'bg-neutral-900' : 'bg-white'
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'

  return (
    <div className={`rounded-xl border-2 p-4 ${styles.bg} ${surface}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-base font-semibold ${strong}`}>{zone.name}</span>
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
          <span>{spark.length > 0 ? clockLabel(spark[0].t) : ''}</span>
          <span>now</span>
          <span>
            {forecast.length > 0 ? `${clockLabel(forecast[forecast.length - 1].t)} (proj.)` : ''}
          </span>
        </div>
      </div>

      <div className={`mt-2 text-sm font-semibold ${styles.text}`}>
        {arrow} {signed(net10)} / 10 min
        {minutesToCapacity !== null && (
          <span className="ml-2 font-normal">
            · full in ~{Math.min(60, Math.round(minutesToCapacity))} min
            {minutesToCapacity > 60 ? '+' : ''}
          </span>
        )}
      </div>

      <div className={`mt-1 text-xs ${muted}`}>
        peak {peak.value.toLocaleString()} at {clockLabel(peak.at)}
        {dwellMin !== null && <> · dwell ~{Math.round(dwellMin)} min (est.)</>}
      </div>
    </div>
  )
}
