import { useMemo, useState } from 'react'
import type { ChartTheme } from './charts'
import { TimeBarChart } from './charts'
import { Section, StatTile } from './sections'
import { ZoneCard } from './ZoneCard'
import { clockLabel } from '../lib/format'
import { computeNetChange, computeOccupancy, minutesToCapacity } from '../lib/occupancy'
import { siteFlow } from '../lib/series'
import type { SiteBucket, ZoneSeries } from '../lib/series'
import type { Accuracy } from '../lib/forecastLog'
import type { ConsistencyFlag } from '../lib/planning/checks'
import { MIN_SAMPLES } from '../lib/planning/queue'
import type { FoodModel, FoodScenario, Assumption } from '../lib/planning/model'
import type { StaffBlock } from '../lib/planning/staffing'
import type { Checkpoint, Reset, Tap, Zone } from '../types'

const MINUTE = 60_000
const pct = (x: number) => `${Math.round(x * 100)}%`
const waitLabel = (min: number) => (min < 0.1 ? 'under 0.1 min' : `${min.toFixed(1)} min`)

const table = 'w-full min-w-[320px] text-sm'
const th = 'py-2 pr-2 font-semibold'
const headRow = 'border-b border-neutral-200 text-left text-xs uppercase text-neutral-600'
const row = 'border-b border-neutral-200'

export const FLAG_KIND_LABEL: Record<ConsistencyFlag['kind'], string> = {
  negative_zone: 'Below zero',
  inner_exceeds_gate: 'Inner areas over gate count',
  out_exceeds_in: 'More out than in',
}

/** Informational only - nothing here changes a count. */
export function ConsistencyList({
  flags,
  theme = 'dark',
}: {
  flags: ConsistencyFlag[]
  theme?: ChartTheme
}) {
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
  const border = theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'
  if (flags.length === 0) {
    return <p className={`text-sm ${muted}`}>No inconsistencies found in the tap log.</p>
  }
  return (
    <ul className="grid gap-1.5">
      {flags.map((f, i) => (
        <li key={i} className={`border-b pb-1.5 text-sm ${border}`}>
          <span className={`font-semibold ${strong}`}>
            {clockLabel(f.at)} · {f.where}
          </span>{' '}
          <span className={muted}>
            — {FLAG_KIND_LABEL[f.kind]}: {f.detail}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Linear (primary) and Holt, scored the same way, side by side. */
export function ForecasterCompare({
  linear,
  holt,
  theme = 'dark',
}: {
  linear: Accuracy
  holt: Accuracy
  theme?: ChartTheme
}) {
  const mae = (a: Accuracy) => (a.mae === null ? '—' : a.mae.toFixed(1))
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatTile
        theme={theme}
        label="Straight line (primary)"
        value={mae(linear)}
        sub={linear.mae === null ? 'nothing scored yet' : `people, mean abs. error · ${linear.count} scored`}
      />
      <StatTile
        theme={theme}
        label="Holt, damped trend"
        value={mae(holt)}
        sub={holt.mae === null ? 'nothing scored yet' : `people, mean abs. error · ${holt.count} scored`}
      />
    </div>
  )
}

/** The report's Planning section, in the order the brief sets out. */
export function PlanningReport({
  attendance,
  attendanceBand,
  zones,
  zoneEnd,
  zoneBand,
  site,
  staffing,
  staffRatio,
  food,
  flags,
  assumptions,
  foodZoneName,
}: {
  attendance: number
  attendanceBand: number
  zones: Zone[]
  zoneEnd: Map<string, number>
  zoneBand: Map<string, number>
  site: SiteBucket[]
  staffing: StaffBlock[] | null
  staffRatio: number | undefined
  food: FoodModel
  flags: ConsistencyFlag[]
  assumptions: Assumption[]
  foodZoneName: string | null
}) {
  return (
    <div className="mt-10 border-t-4 border-black pt-6">
      <h2 className="mb-1 text-2xl font-bold">Planning</h2>
      <p className="mb-6 text-sm text-neutral-600">
        What the evening's counts say about next year's trucks and staff. Every number below
        rests on the assumptions listed at the end; change one on the admin page and this
        section recalculates.
      </p>

      <Section
        title="1. Counted attendance"
        note="± is one standard deviation from missed taps alone, under the assumed miss rate. Missed people make a count run low, so read the band as a floor on the uncertainty."
        theme="light"
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile
            theme="light"
            label="Total attendance"
            value={`${attendance.toLocaleString()} ± ${attendanceBand.toLocaleString()}`}
            sub="everyone counted in through the gates"
            emphasis
          />
        </div>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr className={headRow}>
                <th className={th}>Zone</th>
                <th className={`${th} text-right`}>At close</th>
                <th className={`${th} text-right`}>± band</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className={row}>
                  <td className="py-2 pr-2 font-medium">{z.name}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{(zoneEnd.get(z.id) ?? 0).toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">± {(zoneBand.get(z.id) ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="2. Arrivals and staffing"
        note="Bars are people entering the site per 5 minutes. The table is your ratio applied to counted occupancy: the most people on site at any minute of each 15-minute block, divided by the ratio, rounded up."
        theme="light"
      >
        <TimeBarChart data={site} dataKey="arrivals" label="arrivals" theme="light" height={180} />
        {staffing === null ? (
          <p className="mt-3 rounded-lg border border-dashed border-neutral-400 p-3 text-sm text-neutral-700">
            No staffing ratio entered. Set "people on site per staff member" on the admin page to
            fill this table. The app does not suggest one.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <p className="mb-1 text-xs text-neutral-600">
              Your ratio: 1 staff member per {staffRatio} people on site. Peak blocks are highlighted.
            </p>
            <table className={table}>
              <thead>
                <tr className={headRow}>
                  <th className={th}>Block</th>
                  <th className={`${th} text-right`}>Most on site</th>
                  <th className={`${th} text-right`}>Staff needed</th>
                </tr>
              </thead>
              <tbody>
                {staffing.map((b) => (
                  <tr key={b.t} className={`${row} ${b.isPeak ? 'bg-amber-100 font-semibold' : ''}`}>
                    <td className="py-1.5 pr-2">
                      {clockLabel(b.t)}–{clockLabel(b.t + 15 * MINUTE)}
                      {b.isPeak && <span className="ml-2 text-xs text-amber-800">peak</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{b.peakOnSite.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{b.staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="3. Food trucks: what if"
        note="Best case: the food court is modelled as one pooled line, as if every customer always found the shortest queue. Real lines at separate trucks do worse."
        theme="light"
      >
        <FoodSection food={food} foodZoneName={foodZoneName} />
      </Section>

      <Section
        title="4. Consistency checks"
        note="Places and times where the counts disagree with themselves. Informational only: nothing here has been corrected."
        theme="light"
      >
        <ConsistencyList flags={flags} theme="light" />
      </Section>

      <Section title="5. Assumptions" theme="light">
        <div className="rounded-lg border-2 border-black p-3">
          <table className="w-full text-sm">
            <tbody>
              {assumptions.map((a) => (
                <tr key={a.label} className="border-b border-neutral-200 last:border-0">
                  <td className="py-1.5 pr-3 align-top font-medium">{a.label}</td>
                  <td className="py-1.5 pr-3 align-top">{a.value}</td>
                  <td className="py-1.5 text-right align-top text-xs text-neutral-600 uppercase">
                    {a.source === 'organizer'
                      ? 'your input'
                      : a.source === 'default'
                        ? 'default'
                        : a.source === 'missing'
                          ? 'not entered'
                          : 'model'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function FoodSection({ food, foodZoneName }: { food: FoodModel; foodZoneName: string | null }) {
  if (food.status === 'no-zone') {
    return <Missing>Choose the food court zone on the admin page.</Missing>
  }
  if (food.status === 'no-trucks') {
    return <Missing>No food trucks are set up. Add them on the admin page.</Missing>
  }
  if (food.status === 'no-samples') {
    return (
      <>
        <Missing>
          Not enough samples. Each truck needs at least {MIN_SAMPLES} timed customers from the
          service-timer screen before its speed is used.
        </Missing>
        <TruckTable rates={food.rates} />
      </>
    )
  }

  return (
    <>
      <TruckTable rates={food.rates} />
      <p className="mt-3 mb-2 text-sm text-neutral-700">
        {food.servers} truck{food.servers === 1 ? '' : 's'} serving on average{' '}
        {food.mu.toFixed(2)} customers a minute each. Target: nobody waits {food.targetMin} min
        or more.
        {food.sensitivity && (
          <>
            {' '}
            <strong>No order share entered</strong>, so the table is shown at 50%, 75% and 100%
            of food-court arrivals ordering.
          </>
        )}
      </p>
      <div className={`grid gap-4 ${food.scenarios.length > 1 ? 'md:grid-cols-3' : ''}`}>
        {food.scenarios.map((s) => (
          <WhatIfTable key={s.share} s={s} actual={food.servers} targetMin={food.targetMin} />
        ))}
      </div>
      <ul className="mt-3 list-disc pl-5 text-xs text-neutral-600">
        <li>
          Arrival rate λ = people walking into {foodZoneName ?? 'the food court'}, per 5-minute
          block, times the share who order.
        </li>
        <li>
          Service rate μ = 1 ÷ mean service time for each truck with at least {MIN_SAMPLES} timed
          customers, averaged across trucks.
        </li>
        <li>
          Utilisation ρ = λ ÷ (trucks × μ). Wait = Erlang C for an M/M/c queue: random
          arrivals, random service times, one shared line.
        </li>
        <li>
          At ρ ≥ 1 the trucks cannot keep up and the line grows for as long as that lasts; no
          wait is given, only the minutes it lasted.
        </li>
        <li>Each 5-minute block is treated as settled. A real line lags behind a surge and clears late.</li>
      </ul>
    </>
  )
}

function WhatIfTable({ s, actual, targetMin }: { s: FoodScenario; actual: number; targetMin: number }) {
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-sm font-semibold">{pct(s.share)} of arrivals order</div>
      {s.peakBin && (
        <p className="mb-1 text-xs text-neutral-600">
          Busiest block {clockLabel(s.peakBin.t)}: ρ = {s.peakBin.rho.toFixed(2)} with {actual}{' '}
          trucks.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className={headRow}>
            <th className={th}>Trucks</th>
            <th className={`${th} text-right`}>Peak wait</th>
            <th className={`${th} text-right`}>
              Min at <span className="normal-case">ρ</span> ≥ 1
            </th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => {
            const best = r.servers === s.recommended
            return (
              <tr key={r.servers} className={`${row} ${best ? 'bg-emerald-100 font-semibold' : ''}`}>
                <td className="py-1.5 pr-2">
                  {r.servers}
                  {r.servers === actual && <span className="ml-1 text-xs text-neutral-600">(actual)</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {r.growingMin > 0 ? 'line growing' : waitLabel(r.peakWqMin)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{r.growingMin}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-neutral-600">
        {s.recommended === null
          ? `None of these keeps every wait under ${targetMin} min.`
          : `Fewest trucks keeping every wait under ${targetMin} min: ${s.recommended}.`}
      </p>
    </div>
  )
}

function TruckTable({ rates }: { rates: import('../lib/planning/queue').TruckRate[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={table}>
        <thead>
          <tr className={headRow}>
            <th className={th}>Truck</th>
            <th className={`${th} text-right`}>Timed</th>
            <th className={`${th} text-right`}>Mean service</th>
            <th className={`${th} text-right`}>
              <span className="normal-case">μ</span> / min
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.truck.id} className={row}>
              <td className="py-1.5 pr-2 font-medium">{r.truck.name}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{r.samples}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {r.meanSec === null ? 'not enough samples' : `${Math.round(r.meanSec)} s`}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.muPerMin === null ? '—' : r.muPerMin.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-400 p-3 text-sm text-neutral-700">
      {children}
    </p>
  )
}

/**
 * Drag through the evening and see the dashboard's numbers as they were at
 * that minute. Everything is rebuilt from the tap log; nothing is stored.
 */
export function ReplayScrubber({
  zones,
  checkpoints,
  taps,
  resets,
  series,
  from,
  to,
  flags,
  bandsAt,
}: {
  zones: Zone[]
  checkpoints: Checkpoint[]
  taps: Tap[]
  resets: Reset[]
  series: Map<string, ZoneSeries>
  from: number
  to: number
  flags: ConsistencyFlag[]
  bandsAt: (t: number) => { attendance: number; zones: Map<string, number> }
}) {
  const [at, setAt] = useState(to)
  const t = Math.min(to, Math.max(from, at))

  const state = useMemo(() => {
    const occupancy = computeOccupancy(zones, checkpoints, taps, resets, t)
    const net10 = computeNetChange(zones, checkpoints, taps, t - 10 * MINUTE, t)
    const site = siteFlow(checkpoints, taps, from, t, MINUTE)
    return { occupancy, net10, last: site.at(-1), band: bandsAt(t) }
  }, [zones, checkpoints, taps, resets, t, from, bandsAt])

  const raised = flags.filter((f) => f.at <= t)

  return (
    <Section
      title="Replay"
      note="Drag to any minute of the evening to see what the dashboard showed then, rebuilt from the tap log."
      theme="light"
    >
      <div className="no-print mb-3 flex items-center gap-3">
        <input
          type="range"
          aria-label="Time"
          min={from}
          max={to}
          step={MINUTE}
          value={t}
          onChange={(e) => setAt(Number(e.target.value))}
          className="w-full"
        />
        <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{clockLabel(t)}</span>
      </div>
      <p className="mb-2 hidden text-sm print:block">As of {clockLabel(t)}.</p>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          theme="light"
          label="Attendance so far"
          value={`${(state.last?.cumulativeArrivals ?? 0).toLocaleString()} ± ${state.band.attendance}`}
          sub={`as of ${clockLabel(t)}`}
          emphasis
        />
        <StatTile
          theme="light"
          label="On site"
          value={(state.last?.onSite ?? 0).toLocaleString()}
          sub="through the gates"
        />
        <StatTile theme="light" label="Checks raised" value={String(raised.length)} sub="by this time" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {zones.map((zone) => {
          const current = state.occupancy.get(zone.id) ?? 0
          const net10 = state.net10.get(zone.id) ?? 0
          const points = (series.get(zone.id)?.points ?? []).filter((p) => p.t <= t)
          const peak = points.reduce((b, p) => (p.v > b.value ? { value: p.v, at: p.t } : b), {
            value: 0,
            at: from,
          })
          return (
            <ZoneCard
              key={zone.id}
              theme="light"
              compact
              stats={{
                zone,
                occupancy: current,
                net10,
                spark: points,
                forecast: [],
                minutesToCapacity: minutesToCapacity(current, zone.capacity, net10, 10),
                peak,
                dwellMin: null,
                band: state.band.zones.get(zone.id) ?? 0,
              }}
            />
          )
        })}
      </div>
    </Section>
  )
}
