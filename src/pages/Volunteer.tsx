import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig, useMyRecentTaps } from '../lib/data'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/useWakeLock'
import { UNDO_WINDOW_MS, raiseFlag, recordTap, undoTap, undoableTap } from '../lib/writes'
import { OUTSIDE } from '../types'
import type { FlagType, TapDirection } from '../types'
import { Screen } from '../components/Screen'

const FLAG_OPTIONS: { type: FlagType; label: string }[] = [
  { type: 'long_line', label: 'Long line' },
  { type: 'hazard', label: 'Spill or hazard' },
  { type: 'needs_staff', label: 'Needs staff' },
  { type: 'medical', label: 'Medical' },
]

function buzz(pattern: number | number[]) {
  if ('vibrate' in navigator) navigator.vibrate(pattern)
}

export function Volunteer() {
  const { eventId, token } = useParams<{ eventId: string; token: string }>()
  const { uid, error: authError } = useAuth()
  const { event, zones, checkpoints, loading, notFound } = useEventConfig(eventId)
  const { taps, pendingCount } = useMyRecentTaps(eventId, uid)
  const now = useNow(1000)

  const [flagSheetOpen, setFlagSheetOpen] = useState(false)
  const [flagSent, setFlagSent] = useState<string | null>(null)
  const [flash, setFlash] = useState<TapDirection | null>(null)

  useWakeLock(true)

  const checkpoint = useMemo(
    () => checkpoints.find((c) => c.token === token) ?? null,
    [checkpoints, token],
  )

  const zoneName = (id: string) =>
    id === OUTSIDE ? 'Outside' : (zones.find((z) => z.id === id)?.name ?? 'Unknown')

  // Taps from this device, at this checkpoint, in the last 60 seconds.
  const recentCount = useMemo(() => {
    if (!checkpoint) return 0
    return taps.filter(
      (t) =>
        !t.undone &&
        t.checkpointId === checkpoint.id &&
        now - t.clientTs.toMillis() <= 60_000,
    ).length
  }, [taps, checkpoint, now])

  const undoTarget = checkpoint ? undoableTap(taps, checkpoint.id, now) : null
  const undoSecondsLeft = undoTarget
    ? Math.ceil((UNDO_WINDOW_MS - (now - undoTarget.clientTs.toMillis())) / 1000)
    : 0

  if (authError) {
    return (
      <Screen title="Can't start">
        <p className="text-lg">
          This phone needs signal the first time it opens the app. Move somewhere with
          service and reload.
        </p>
        <p className="mt-4 text-sm text-neutral-400">{authError}</p>
      </Screen>
    )
  }
  if (loading || !uid) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" >
    <p className="text-lg">Check with the organizer that this card is for today's event.</p>
  </Screen>
  if (!checkpoint) {
    return (
      <Screen title="Card not recognised">
        <p className="text-lg">
          This QR card does not match a checkpoint in {event?.name ?? 'this event'}. Ask
          the organizer for the right card.
        </p>
      </Screen>
    )
  }

  const tap = (direction: TapDirection) => {
    recordTap(eventId!, checkpoint.id, direction, uid)
    buzz(35)
    setFlash(direction)
    setTimeout(() => setFlash(null), 120)
  }

  const doUndo = () => {
    if (!undoTarget) return
    undoTap(eventId!, undoTarget.id)
    buzz([20, 40, 20])
  }

  const sendFlag = (type: FlagType, label: string) => {
    raiseFlag(eventId!, checkpoint.id, type)
    buzz(120)
    setFlagSheetOpen(false)
    setFlagSent(label)
    setTimeout(() => setFlagSent(null), 3000)
  }

  const inLabel = zoneName(checkpoint.toZoneId)
  const outLabel = zoneName(checkpoint.fromZoneId)

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-neutral-950 select-none">
      {/* Header: who am I, and is it working? */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-neutral-100">
            {checkpoint.name}
          </div>
          <div className="truncate text-xs text-neutral-400">
            {recentCount} tap{recentCount === 1 ? '' : 's'} in last 60s
          </div>
        </div>
        <SyncPill pendingCount={pendingCount} />
      </header>

      {/* The two things a volunteer actually does. */}
      <button
        onClick={() => tap('in')}
        className={`flex flex-1 flex-col items-center justify-center gap-1 border-4 border-emerald-400 bg-emerald-600 active:bg-emerald-400 ${
          flash === 'in' ? 'bg-emerald-300' : ''
        }`}
      >
        <span className="text-6xl font-black tracking-tight text-white">IN</span>
        <span className="px-3 text-center text-xl font-semibold text-emerald-50">
          → {inLabel}
        </span>
      </button>

      <button
        onClick={() => tap('out')}
        className={`flex flex-1 flex-col items-center justify-center gap-1 border-4 border-red-400 bg-red-700 active:bg-red-500 ${
          flash === 'out' ? 'bg-red-400' : ''
        }`}
      >
        <span className="text-6xl font-black tracking-tight text-white">OUT</span>
        <span className="px-3 text-center text-xl font-semibold text-red-50">
          → {outLabel}
        </span>
      </button>

      {/* Rarely used, so small - but still full-width targets. */}
      <footer className="flex shrink-0 gap-2 p-2">
        <button
          onClick={doUndo}
          disabled={!undoTarget}
          className="flex-1 rounded-lg bg-neutral-800 py-3 text-lg font-bold text-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          {undoTarget ? `UNDO (${undoSecondsLeft}s)` : 'UNDO'}
        </button>
        <button
          onClick={() => setFlagSheetOpen(true)}
          className="flex-1 rounded-lg bg-amber-600 py-3 text-lg font-bold text-white active:bg-amber-400"
        >
          FLAG
        </button>
      </footer>

      {flagSent && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-white px-5 py-2 text-base font-bold text-black">
          {flagSent} sent
        </div>
      )}

      {flagSheetOpen && (
        <div className="fixed inset-0 z-10 flex flex-col justify-end bg-black/80 p-3">
          <div className="mb-2 text-center text-lg font-semibold text-neutral-200">
            What's wrong?
          </div>
          {FLAG_OPTIONS.map((o) => (
            <button
              key={o.type}
              onClick={() => sendFlag(o.type, o.label)}
              className="mb-2 rounded-xl bg-amber-600 py-5 text-2xl font-bold text-white active:bg-amber-400"
            >
              {o.label}
            </button>
          ))}
          <button
            onClick={() => setFlagSheetOpen(false)}
            className="rounded-xl bg-neutral-800 py-5 text-2xl font-bold text-neutral-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Never blocks tapping. Amber simply means "these taps are still on the phone",
 * which is fine and expected at a park.
 */
function SyncPill({ pendingCount }: { pendingCount: number }) {
  const synced = pendingCount === 0
  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
        synced ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${synced ? 'bg-emerald-400' : 'bg-amber-400'}`}
      />
      {synced ? 'Synced' : `${pendingCount} waiting`}
    </div>
  )
}
