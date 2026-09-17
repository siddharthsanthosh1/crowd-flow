import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ChartTheme } from './charts'
import { BAND_STYLES, clockLabel, durationLabel } from '../lib/format'
import type { Band } from '../lib/format'
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
  emphasis = false,
  tone,
}: {
  label: string
  value: string
  sub?: string
  theme?: ChartTheme
  /** The headline number of the strip. One tile only, or nothing leads. */
  emphasis?: boolean
  tone?: Band
}) {
  const surface = theme === 'dark' ? 'bg-neutral-900' : 'bg-neutral-50'
  const border = tone
    ? BAND_STYLES[tone].bg
    : theme === 'dark'
      ? 'border-neutral-800'
      : 'border-neutral-200'
  const muted = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'
  const strong = theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
  const valueColor = tone ? BAND_STYLES[tone].text : strong
  return (
    <div className={`rounded-lg border p-3 ${surface} ${border}`}>
      <div className={`text-xs ${muted}`}>{label}</div>
      <div
        className={`mt-0.5 font-bold tabular-nums ${valueColor} ${
          emphasis ? 'text-3xl sm:text-4xl' : 'text-2xl'
        }`}
      >
        {value}
      </div>
      {sub && <div className={`mt-0.5 text-xs leading-tight ${muted}`}>{sub}</div>}
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
 * The one thing that needs doing right now.
 *
 * Shown when a zone is over 85% or is projected to fill within 15 minutes,
 * together with whatever the organizer wrote down to do about it. It is the
 * only red thing on the screen, so it cannot be confused with the zone cards
 * below - and it is dismissable, because an alert that cannot be silenced gets
 * ignored, and an ignored alert is worse than none.
 */
export function AlertBanner({
  alerts,
  actions,
  soundOn,
  onToggleSound,
  onDismiss,
}: {
  alerts: ZoneAlert[]
  actions: SuggestedAction[]
  soundOn: boolean
  onToggleSound: () => void
  onDismiss: () => void
}) {
  if (alerts.length === 0) return null

  // Soonest to fill leads; a zone already over the line but steady comes after.
  const ranked = [...alerts].sort((a, b) => {
    const am = a.minutesToCapacity ?? Infinity
    const bm = b.minutesToCapacity ?? Infinity
    return am === bm ? b.pct - a.pct : am - bm
  })
  const lead = ranked[0]
  const action = actions
    .filter((x) => x.zoneId === lead.zone.id && lead.pct >= x.thresholdPct)
    .sort((x, y) => y.thresholdPct - x.thresholdPct)[0]

  const what =
    lead.minutesToCapacity !== null
      ? `${lead.pct}% · full in ~${Math.min(60, Math.round(lead.minutesToCapacity))} min`
      : `${lead.pct}% of capacity`

  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border-2 border-red-500 bg-red-950 p-3">
      <button
        onClick={onDismiss}
        className="min-w-0 flex-1 text-left"
        aria-label="Dismiss this alert for ten minutes"
      >
        <span className="block text-sm leading-snug">
          <span className="font-bold text-red-100">⚠ {lead.zone.name}</span>
          <span className="text-red-200"> · {what}</span>
          {action && <span className="text-red-100"> → {action.text}</span>}
          {ranked.length > 1 && (
            <span className="text-red-300/80"> · +{ranked.length - 1} more</span>
          )}
        </span>
        <span className="mt-0.5 block text-[10px] text-red-300/70">tap to dismiss for 10 min</span>
      </button>
      <button
        onClick={onToggleSound}
        className="shrink-0 rounded-full bg-red-900 px-3 py-1 text-xs font-semibold text-red-100"
      >
        {soundOn ? '🔔' : '🔕'}
      </button>
    </div>
  )
}

/**
 * Everything the organizer does not need while something is happening. Present,
 * one tap away, and not competing with the numbers above it.
 */
export function MoreDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-8 rounded-xl border border-neutral-800">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full p-3 text-left text-sm font-semibold text-neutral-400"
      >
        More {open ? '▴' : '▾'}
        <span className="ml-2 font-normal text-neutral-600">
          flow, throughput, operations log
        </span>
      </button>
      {/* Mounted only when open. Every chart in here is a live Recharts tree
          that measures itself on every resize; building four of them behind a
          closed drawer is work a phone does not need to do. */}
      {open && <div className="border-t border-neutral-800 p-3">{children}</div>}
    </div>
  )
}

/**
 * On a phone the combined chart is a second screenful of scrolling before the
 * zone cards; on a desktop there is room for it to simply be open.
 */
export function CollapsibleSection({
  title,
  note,
  openByDefault,
  children,
}: {
  title: string
  note?: string
  openByDefault: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(openByDefault)
  // The screen can change under us - a phone turned sideways, a window resized.
  const [wasDefault, setWasDefault] = useState(openByDefault)
  if (wasDefault !== openByDefault) {
    setWasDefault(openByDefault)
    setOpen(openByDefault)
  }

  return (
    <section className="mb-7">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs font-semibold tracking-wide text-neutral-400 uppercase"
      >
        {title} {open ? '▴' : '▾'}
      </button>
      {note && open && <p className="mt-0.5 mb-2 text-xs text-neutral-500">{note}</p>}
      {open && <div className="mt-2">{children}</div>}
    </section>
  )
}

/** Unmissable, because simulated data must never be read as real data. */
export function SimulatedBadge() {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-fuchsia-500 bg-fuchsia-950 px-3 py-2">
      <span className="rounded bg-fuchsia-500 px-2 py-0.5 text-xs font-black tracking-widest text-fuchsia-950">
        SIMULATED
      </span>
      <span className="min-w-0 text-xs leading-tight text-fuchsia-200">
        Demo event. These numbers are generated, not counted by anyone.
      </span>
    </div>
  )
}

/**
 * Recalibrate one zone. Pre-filled with 0 because the reason to reset is almost
 * always that the area has visibly emptied and the count has not; the note is
 * optional and goes straight into the operations log, so the report can say why
 * the number jumped.
 */
export function ResetDialog({
  zoneName,
  onCancel,
  onConfirm,
}: {
  zoneName: string
  onCancel: () => void
  onConfirm: (count: number, note: string) => void
}) {
  const [count, setCount] = useState('0')
  const [note, setNote] = useState('')
  const parsed = Math.max(0, Math.round(Number(count) || 0))

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold">Reset {zoneName}</h3>
        <p className="mt-1 mb-3 text-sm text-neutral-400">
          Sets the count to a number you can see is right. The taps stay in the log, and
          this zone's confidence goes back to high.
        </p>

        <label className="mb-3 grid gap-1 text-sm text-neutral-400">
          Set the count to
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-2xl font-bold text-neutral-100"
          />
        </label>

        <label className="mb-4 grid gap-1 text-sm text-neutral-400">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lawn cleared after the fireworks"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
          />
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-3 font-semibold text-neutral-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(parsed, note.trim())}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white"
          >
            Set to {parsed.toLocaleString()}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Organizer actions live behind this. It is a lock in the header rather than a
 * box in the page because on the night nobody is unlocking anything - they are
 * reading numbers - and an input field at the top of a dashboard is a thing to
 * scroll past a hundred times.
 */
export function HeaderLock({
  isAdmin,
  error,
  onUnlock,
}: {
  isAdmin: boolean
  error: string | null
  onUnlock: (secret: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={isAdmin ? 'Organizer actions are unlocked on this device' : 'Unlock organizer actions'}
        aria-label={isAdmin ? 'Organizer actions unlocked' : 'Unlock organizer actions'}
        className={`rounded-lg px-2 py-1 text-sm ${
          isAdmin ? 'text-emerald-400' : 'text-neutral-500'
        }`}
      >
        {isAdmin ? '🔓' : '🔒'}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-1 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          {isAdmin ? (
            <p className="text-sm text-neutral-400">
              Unlocked. This device can record forecasts, acknowledge flags and reset zones.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-neutral-400">
                Enter the admin secret to record forecasts, acknowledge flags and reset zones
                from this device.
              </p>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-neutral-100"
              />
              <button
                onClick={() => onUnlock(value)}
                className="w-full rounded-lg bg-neutral-700 px-4 py-2 font-bold"
              >
                Unlock
              </button>
              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
