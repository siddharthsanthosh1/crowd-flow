import type { ReactNode } from 'react'
import type { ChartTheme } from './charts'
import { clockLabel, durationLabel } from '../lib/format'
import type { OpsEntry } from '../lib/opsLog'
import type { Throughput } from '../lib/series'
import type { Checkpoint, SuggestedAction, Zone } from '../types'

export function Section({
  title,
  note,
  children,
  theme = 'dark',
}: {
  title: string
  note?: string
  children: ReactNode
  theme?: ChartTheme
}) {
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const faint = theme === 'dark' ? 'text-neutral-500' : 'text-neutral-500'
  return (
    <section className="mb-7">
      <h2 className={`text-xs font-semibold tracking-wide uppercase ${muted}`}>{title}</h2>
      {note && <p className={`mt-0.5 mb-2 text-xs ${faint}`}>{note}</p>}
      <div className={note ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

/** A single number that is the whole answer - no chart needed. */
export function StatTile({
  label,
  value,
  sub,
  theme = 'dark',
}: {
  label: string
  value: string
  sub?: string
  theme?: ChartTheme
}) {
  const surface = theme === 'dark' ? 'bg-neutral-900' : 'bg-neutral-50'
  const border = theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
  return (
    <div className={`rounded-lg border p-3 ${surface} ${border}`}>
      <div className={`text-xs ${muted}`}>{label}</div>
      <div className={`mt-0.5 text-2xl font-bold ${strong}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${muted}`}>{sub}</div>}
    </div>
  )
}

const SEVERITY_STYLES = {
  info: 'border-neutral-700 text-neutral-300',
  warn: 'border-amber-500 text-amber-300',
  critical: 'border-red-500 text-red-300',
} as const

const SEVERITY_STYLES_LIGHT = {
  info: 'border-neutral-300 text-neutral-700',
  warn: 'border-amber-500 text-amber-800',
  critical: 'border-red-500 text-red-800',
} as const

const KIND_LABELS: Record<OpsEntry['kind'], string> = {
  alert: 'Alert',
  flag: 'Flag',
  reset: 'Reset',
  forecast: 'Forecast',
}

/** Alerts, flags, resets and scored forecasts on one timeline. */
export function OpsLogList({
  entries,
  theme = 'dark',
  limit = 40,
}: {
  entries: OpsEntry[]
  theme?: ChartTheme
  limit?: number
}) {
  const styles = theme === 'dark' ? SEVERITY_STYLES : SEVERITY_STYLES_LIGHT
  const muted = theme === 'dark' ? 'text-neutral-500' : 'text-neutral-500'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'

  if (entries.length === 0) {
    return <p className={`text-sm ${muted}`}>Nothing has happened yet.</p>
  }

  return (
    <ol className="grid gap-1.5">
      {entries.slice(0, limit).map((entry) => (
        <li
          key={entry.id}
          className={`flex items-baseline gap-2 border-l-2 py-1 pl-3 ${styles[entry.severity]}`}
        >
          <span className={`w-14 shrink-0 text-xs tabular-nums ${muted}`}>
            {clockLabel(entry.at)}
          </span>
          <span className={`w-16 shrink-0 text-[10px] tracking-wide uppercase ${muted}`}>
            {KIND_LABELS[entry.kind]}
          </span>
          <span className="min-w-0">
            <span className={`text-sm font-semibold ${strong}`}>{entry.title}</span>
            <span className={`block text-xs ${muted}`}>{entry.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Who is moving where, over a short recent window. A table, not a chart. */
export function FlowTable({
  checkpoints,
  throughput,
  zoneName,
  theme = 'dark',
}: {
  checkpoints: Checkpoint[]
  throughput: Throughput[]
  zoneName: (id: string) => string
  theme?: ChartTheme
}) {
  const byId = new Map(throughput.map((t) => [t.checkpointId, t]))
  const border = theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[340px] text-sm">
        <thead>
          <tr className={`border-b text-left text-xs uppercase ${border} ${muted}`}>
            <th className="py-2 pr-2 font-semibold">Checkpoint</th>
            <th className="py-2 pr-2 text-right font-semibold">In</th>
            <th className="py-2 pr-2 text-right font-semibold">Out</th>
            <th className="py-2 text-right font-semibold">Net</th>
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp) => {
            const row = byId.get(cp.id)
            const net = (row?.in ?? 0) - (row?.out ?? 0)
            return (
              <tr key={cp.id} className={`border-b ${border}`}>
                <td className="py-2 pr-2">
                  <span className={`block font-medium ${strong}`}>{cp.name}</span>
                  <span className={`block text-xs ${muted}`}>
                    {zoneName(cp.fromZoneId)} → {zoneName(cp.toZoneId)}
                  </span>
                </td>
                <td className={`py-2 pr-2 text-right tabular-nums ${strong}`}>{row?.in ?? 0}</td>
                <td className={`py-2 pr-2 text-right tabular-nums ${strong}`}>{row?.out ?? 0}</td>
                <td className={`py-2 text-right font-semibold tabular-nums ${strong}`}>
                  {net > 0 ? `+${net}` : net}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A quiet checkpoint means the numbers are wrong, so this stays prominent. */
export function CheckpointHealth({
  checkpoints,
  lastTap,
  now,
  zoneName,
  amberMs,
  redMs,
  theme = 'dark',
}: {
  checkpoints: Checkpoint[]
  lastTap: Map<string, number>
  now: number
  zoneName: (id: string) => string
  amberMs: number
  redMs: number
  theme?: ChartTheme
}) {
  const border = theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'
  const muted = theme === 'dark' ? 'text-neutral-500' : 'text-neutral-500'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'

  return (
    <div className={`overflow-hidden rounded-lg border ${border}`}>
      {checkpoints.map((c) => {
        const last = lastTap.get(c.id)
        const silence = last === undefined ? null : now - last
        const color =
          silence === null
            ? 'text-amber-400'
            : silence >= redMs
              ? 'text-red-400'
              : silence >= amberMs
                ? 'text-amber-400'
                : 'text-emerald-400'
        return (
          <div
            key={c.id}
            className={`flex items-center justify-between gap-3 border-b p-3 last:border-b-0 ${border}`}
          >
            <div className="min-w-0">
              <div className={`truncate font-semibold ${strong}`}>{c.name}</div>
              <div className={`truncate text-xs ${muted}`}>
                {zoneName(c.fromZoneId)} ⇄ {zoneName(c.toZoneId)}
              </div>
            </div>
            <div className={`shrink-0 text-sm font-semibold tabular-nums ${color}`}>
              {silence === null ? 'no taps yet' : `last tap ${durationLabel(silence)} ago`}
            </div>
          </div>
        )
      })}
      {checkpoints.length === 0 && <p className={`p-3 ${muted}`}>No checkpoints yet.</p>}
    </div>
  )
}

export type ZoneAlert = {
  zone: Zone
  pct: number
  minutesToCapacity: number | null
}

/**
 * Shown when a zone is over 85% or is projected to fill within 15 minutes,
 * together with whatever the organizer wrote down to do about it.
 */
export function AlertBanner({
  alerts,
  actions,
  soundOn,
  onToggleSound,
}: {
  alerts: ZoneAlert[]
  actions: SuggestedAction[]
  soundOn: boolean
  onToggleSound: () => void
}) {
  if (alerts.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border-2 border-red-500 bg-red-950 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-bold tracking-wide text-red-200 uppercase">
          ⚠ Attention
        </span>
        <button
          onClick={onToggleSound}
          className="rounded-full bg-red-900 px-3 py-1 text-xs font-semibold text-red-100"
        >
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>
      <ul className="grid gap-2">
        {alerts.map((a) => {
          const matching = actions
            .filter((action) => action.zoneId === a.zone.id && a.pct >= action.thresholdPct)
            .sort((x, y) => y.thresholdPct - x.thresholdPct)
          return (
            <li key={a.zone.id}>
              <span className="font-bold text-red-100">
                {a.zone.name} at {a.pct}%
              </span>
              {a.minutesToCapacity !== null && (
                <span className="text-red-200">
                  {' '}
                  · full in ~{Math.min(60, Math.round(a.minutesToCapacity))} min
                </span>
              )}
              {matching.length > 0 && (
                <span className="mt-0.5 block text-sm text-red-100">→ {matching[0].text}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
