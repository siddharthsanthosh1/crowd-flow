import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Point } from '../lib/series'

/**
 * Chart colours. Two selected sets rather than one flipped automatically: the
 * dashboard is dark and lives outdoors at night, the report is printed on white.
 * Both sets were checked for colour-blind separation and contrast against their
 * own surface before being used.
 */
export type ChartTheme = 'dark' | 'light'

const PALETTE = {
  dark: {
    series1: '#3987e5',
    series2: '#d95926',
    threshold: '#e66767',
    grid: '#262626',
    axis: '#737373',
    tooltipBg: '#171717',
    tooltipBorder: '#404040',
    tooltipText: '#f5f5f5',
  },
  light: {
    series1: '#2a78d6',
    series2: '#eb6834',
    threshold: '#e34948',
    grid: '#e5e5e5',
    axis: '#525252',
    tooltipBg: '#ffffff',
    tooltipBorder: '#d4d4d4',
    tooltipText: '#0a0a0a',
  },
} as const

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function tooltipStyle(theme: ChartTheme) {
  const p = PALETTE[theme]
  return {
    contentStyle: {
      background: p.tooltipBg,
      border: `1px solid ${p.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
      color: p.tooltipText,
    },
    labelStyle: { color: p.tooltipText },
    itemStyle: { color: p.tooltipText },
  }
}

const axisProps = (theme: ChartTheme) => ({
  stroke: PALETTE[theme].axis,
  tick: { fill: PALETTE[theme].axis, fontSize: 10 },
  tickLine: false,
  axisLine: false,
})

/**
 * One zone's last 60 minutes, with the next 15 projected as a dashed
 * continuation of the same line - same colour, because it is the same quantity,
 * just not measured yet.
 */
export function ZoneSparkline({
  actual,
  forecast,
  capacity,
  theme = 'dark',
  height = 84,
}: {
  actual: Point[]
  forecast: Point[]
  capacity: number
  theme?: ChartTheme
  height?: number
}) {
  const p = PALETTE[theme]
  const byTime = new Map<number, { t: number; actual: number | null; forecast: number | null }>()
  for (const point of actual) byTime.set(point.t, { t: point.t, actual: point.v, forecast: null })
  for (const point of forecast) {
    const existing = byTime.get(point.t)
    // The join point carries both values so the dashed line starts where the
    // solid one ends rather than floating away from it.
    if (existing) existing.forecast = point.v
    else byTime.set(point.t, { t: point.t, actual: null, forecast: point.v })
  }
  const data = [...byTime.values()].sort((a, b) => a.t - b.t)

  const dataMax = Math.max(1, ...data.map((d) => Math.max(d.actual ?? 0, d.forecast ?? 0)))

  // Scale to the data, not to capacity. A zone holding 469 of 2,500 would
  // otherwise be drawn as a flat line along the bottom of the card, which hides
  // the shape of the hour - the one thing this chart exists to show. The
  // capacity line is drawn only once it is close enough to matter; until then
  // the percentage above the chart carries that information.
  const showCapacity = capacity > 0 && capacity <= dataMax * 1.6
  const top = (showCapacity ? Math.max(dataMax, capacity) : dataMax) * 1.15

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <YAxis hide domain={[0, top]} />
        <XAxis dataKey="t" hide />
        {showCapacity && (
          <ReferenceLine
            y={capacity}
            stroke={p.threshold}
            strokeWidth={1}
            label={{ value: 'capacity', position: 'insideTopRight', fill: p.threshold, fontSize: 9 }}
          />
        )}
        <Tooltip
          {...tooltipStyle(theme)}
          labelFormatter={(t) => clock(Number(t))}
          formatter={(value, name) => [
            Math.round(Number(value)),
            name === 'forecast' ? 'projected' : 'people',
          ]}
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke={p.series1}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke={p.series1}
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** A single quantity over time: people on site, or cumulative attendance. */
export function TimeLineChart({
  data,
  dataKey,
  label,
  theme = 'dark',
  height = 180,
}: {
  data: { t: number }[]
  dataKey: string
  label: string
  theme?: ChartTheme
  height?: number
}) {
  const p = PALETTE[theme]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={p.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => clock(Number(t))} minTickGap={36} {...axisProps(theme)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(theme)} />
        <Tooltip
          {...tooltipStyle(theme)}
          labelFormatter={(t) => clock(Number(t))}
          formatter={(value) => [Math.round(Number(value)), label]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={p.series1}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Counts per time bucket - arrivals per 5 minutes. */
export function TimeBarChart({
  data,
  dataKey,
  label,
  theme = 'dark',
  height = 180,
}: {
  data: { t: number }[]
  dataKey: string
  label: string
  theme?: ChartTheme
  height?: number
}) {
  const p = PALETTE[theme]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={p.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => clock(Number(t))} minTickGap={36} {...axisProps(theme)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(theme)} />
        <Tooltip
          {...tooltipStyle(theme)}
          cursor={{ fill: theme === 'dark' ? '#ffffff10' : '#00000008' }}
          labelFormatter={(t) => clock(Number(t))}
          formatter={(value) => [Math.round(Number(value)), label]}
        />
        <Bar dataKey={dataKey} fill={p.series1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * People per minute at each checkpoint. Horizontal so the checkpoint names stay
 * readable on a phone instead of turning sideways.
 */
export function ThroughputChart({
  data,
  theme = 'dark',
  quietIds,
}: {
  data: { name: string; perMinute: number; id: string }[]
  theme?: ChartTheme
  quietIds?: Set<string>
}) {
  const p = PALETTE[theme]
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 42 + 28)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={p.grid} horizontal={false} />
        <XAxis type="number" {...axisProps(theme)} />
        <YAxis type="category" dataKey="name" width={112} {...axisProps(theme)} />
        <Tooltip
          {...tooltipStyle(theme)}
          cursor={{ fill: theme === 'dark' ? '#ffffff10' : '#00000008' }}
          formatter={(value) => [`${Number(value).toFixed(1)} / min`, 'throughput']}
        />
        <Bar dataKey="perMinute" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((row) => (
            <Cell
              key={row.id}
              fill={quietIds?.has(row.id) ? p.threshold : p.series1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Predicted against actual, for the forecast-accuracy chart on the report. */
export function AccuracyChart({
  data,
  theme = 'light',
  height = 200,
}: {
  data: { t: number; predicted: number; actual: number }[]
  theme?: ChartTheme
  height?: number
}) {
  const p = PALETTE[theme]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={p.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => clock(Number(t))} minTickGap={36} {...axisProps(theme)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(theme)} />
        <Tooltip {...tooltipStyle(theme)} labelFormatter={(t) => clock(Number(t))} />
        <Line
          type="monotone"
          dataKey="actual"
          name="actual"
          stroke={p.series1}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="predicted"
          name="predicted"
          stroke={p.series2}
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Legend for the two-series accuracy chart; identity is never colour alone. */
export function AccuracyLegend({ theme = 'light' }: { theme?: ChartTheme }) {
  const p = PALETTE[theme]
  return (
    <div className="flex gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-5" style={{ background: p.series1 }} />
        actual
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-5"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${p.series2} 0 4px, transparent 4px 8px)`,
          }}
        />
        predicted
      </span>
    </div>
  )
}
