import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useAllTaps, useEventConfig, useFlags } from '../lib/data'
import { useNow } from '../lib/useNow'
import { useAdminAccess } from '../lib/useAdminAccess'
import { acknowledgeFlag } from '../lib/admin'
import {
  computeNetChange,
  computeOccupancy,
  lastTapByCheckpoint,
} from '../lib/occupancy'
import { BAND_STYLES, band, durationLabel, percent, signed } from '../lib/format'
import { OUTSIDE } from '../types'
import type { Checkpoint, Flag, FlagType, Zone } from '../types'
import { Screen } from '../components/Screen'

const TREND_WINDOW_MIN = 10
const TREND_WINDOW_MS = TREND_WINDOW_MIN * 60_000

/** A checkpoint that has gone quiet means the numbers are wrong. */
const AMBER_SILENCE_MS = 120_000
const RED_SILENCE_MS = 300_000

const FLAG_LABELS: Record<FlagType, string> = {
  long_line: 'Long line',
  hazard: 'Spill or hazard',
  needs_staff: 'Needs staff',
  medical: 'Medical',
}

export function Dashboard() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, resets, loading, notFound } = useEventConfig(eventId)
  const { taps } = useAllTaps(eventId)
  const { flags } = useFlags(eventId)
  const { status: adminStatus, error: adminError, unlock } = useAdminAccess(eventId, uid)
  const now = useNow(1000)

  const occupancy = useMemo(
    () => computeOccupancy(zones, checkpoints, taps, resets, now),
    [zones, checkpoints, taps, resets, now],
  )
  const trend = useMemo(
    () => computeNetChange(zones, checkpoints, taps, now - TREND_WINDOW_MS, now),
    [zones, checkpoints, taps, now],
  )
  const lastTap = useMemo(() => lastTapByCheckpoint(taps), [taps])

  const openFlags = flags.filter((f) => !f.acknowledged)
  const closedFlags = flags.filter((f) => f.acknowledged).slice(0, 10)

  if (loading) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" />

  const zoneName = (id: string) =>
    id === OUTSIDE ? 'Outside' : (zones.find((z) => z.id === id)?.name ?? 'Unknown')

  return (
    <div className="min-h-[100svh] bg-neutral-950 p-3 pb-16 text-neutral-100">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="truncate text-xl font-bold">{event?.name}</h1>
        <span className="shrink-0 text-xs text-neutral-500">live</span>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {zones.map((z) => (
          <ZoneCard
            key={z.id}
            zone={z}
            occupancy={occupancy.get(z.id) ?? 0}
            net={trend.get(z.id) ?? 0}
          />
        ))}
        {zones.length === 0 && (
          <p className="text-neutral-400">No zones yet. Set them up on the admin page.</p>
        )}
      </section>

      <Flags
        openFlags={openFlags}
        closedFlags={closedFlags}
        checkpoints={checkpoints}
        now={now}
        canAcknowledge={adminStatus === 'yes'}
        onAcknowledge={(id) => eventId && acknowledgeFlag(eventId, id)}
      />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-neutral-400 uppercase">
          Checkpoint health
        </h2>
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          {checkpoints.map((c) => (
            <CheckpointRow
              key={c.id}
              checkpoint={c}
              lastTapMs={lastTap.get(c.id)}
              now={now}
              zoneName={zoneName}
            />
          ))}
          {checkpoints.length === 0 && (
            <p className="p-3 text-neutral-400">No checkpoints yet.</p>
          )}
        </div>
      </section>

      {adminStatus === 'no' && <UnlockBox error={adminError} onUnlock={unlock} />}
    </div>
  )
}

function ZoneCard({
  zone,
  occupancy,
  net,
}: {
  zone: Zone
  occupancy: number
  net: number
}) {
  const pct = percent(occupancy, zone.capacity)
  const styles = BAND_STYLES[band(pct)]
  const arrow = net > 0 ? '▲' : net < 0 ? '▼' : '■'

  return (
    <div className={`rounded-xl border-2 p-4 ${styles.bg}`}>
      <div className="mb-1 truncate text-base font-semibold text-neutral-200">
        {zone.name}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-black tabular-nums">
          {occupancy.toLocaleString()}
        </span>
        <span className={`text-xl font-bold tabular-nums ${styles.text}`}>{pct}%</span>
      </div>
      <div className="mt-1 text-sm text-neutral-400">
        of {zone.capacity.toLocaleString()} capacity
      </div>
      <div className={`mt-2 text-sm font-semibold tabular-nums ${styles.text}`}>
        {arrow} {signed(net)} / {TREND_WINDOW_MIN} min
      </div>
    </div>
  )
}

function CheckpointRow({
  checkpoint,
  lastTapMs,
  now,
  zoneName,
}: {
  checkpoint: Checkpoint
  lastTapMs: number | undefined
  now: number
  zoneName: (id: string) => string
}) {
  const silence = lastTapMs === undefined ? Infinity : now - lastTapMs
  const color =
    silence >= RED_SILENCE_MS
      ? 'text-red-400'
      : silence >= AMBER_SILENCE_MS
        ? 'text-amber-400'
        : 'text-emerald-400'

  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-800 p-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-semibold">{checkpoint.name}</div>
        <div className="truncate text-xs text-neutral-500">
          {zoneName(checkpoint.fromZoneId)} ⇄ {zoneName(checkpoint.toZoneId)}
        </div>
      </div>
      <div className={`shrink-0 text-sm font-semibold tabular-nums ${color}`}>
        {lastTapMs === undefined ? 'no taps yet' : `last tap ${durationLabel(silence)} ago`}
      </div>
    </div>
  )
}

function Flags({
  openFlags,
  closedFlags,
  checkpoints,
  now,
  canAcknowledge,
  onAcknowledge,
}: {
  openFlags: Flag[]
  closedFlags: Flag[]
  checkpoints: Checkpoint[]
  now: number
  canAcknowledge: boolean
  onAcknowledge: (id: string) => void
}) {
  const cpName = (id: string) =>
    checkpoints.find((c) => c.id === id)?.name ?? 'Unknown checkpoint'

  if (openFlags.length === 0 && closedFlags.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-neutral-400 uppercase">
        Flags
      </h2>
      <div className="grid gap-2">
        {openFlags.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-3 rounded-lg border-2 border-amber-500 bg-amber-950 p-3"
          >
            <div className="min-w-0">
              <div className="font-bold text-amber-200">{FLAG_LABELS[f.type]}</div>
              <div className="truncate text-xs text-amber-400/80">
                {cpName(f.checkpointId)} · {durationLabel(now - f.clientTs.toMillis())} ago
              </div>
            </div>
            {canAcknowledge && (
              <button
                onClick={() => onAcknowledge(f.id)}
                className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 font-bold text-white"
              >
                Got it
              </button>
            )}
          </div>
        ))}
        {closedFlags.map((f) => (
          <div key={f.id} className="flex gap-2 px-1 text-xs text-neutral-500">
            <span className="line-through">{FLAG_LABELS[f.type]}</span>
            <span>{cpName(f.checkpointId)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function UnlockBox({
  error,
  onUnlock,
}: {
  error: string | null
  onUnlock: (secret: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <section className="rounded-lg border border-neutral-800 p-3">
      <p className="mb-2 text-sm text-neutral-400">
        Enter the admin secret to acknowledge flags and reset zones from this device.
      </p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono"
        />
        <button
          onClick={() => onUnlock(value)}
          className="rounded-lg bg-neutral-700 px-4 py-2 font-bold"
        >
          Unlock
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  )
}
