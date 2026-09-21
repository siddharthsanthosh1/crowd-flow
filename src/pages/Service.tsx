import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig } from '../lib/data'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/useWakeLock'
import {
  recordServiceTime,
  undoServiceTime,
  useServiceTimes,
  useTrucks,
} from '../lib/planning/data'
import { MIN_SAMPLES } from '../lib/planning/queue'
import type { PlanningEvent } from '../lib/planning/types'
import { Screen } from '../components/Screen'

/** Undo is offered for this long after a customer is logged. */
const UNDO_MS = 60_000

function buzz(pattern: number | number[]) {
  if ('vibrate' in navigator) navigator.vibrate(pattern)
}

/**
 * Service-time timer, for the volunteer on the food path for half an hour
 * before the rush. START when a customer reaches the window, DONE when they
 * walk away with food. Separate from the counting screen on purpose.
 *
 * Offline-first the same way the counting screen is: every sample goes to
 * Firestore's local store first and syncs when signal comes back.
 */
export function Service() {
  const { eventId, token } = useParams<{ eventId: string; token: string }>()
  const { uid, error: authError } = useAuth()
  const { event, loading, notFound } = useEventConfig(eventId, uid)
  const { trucks } = useTrucks(eventId, uid)
  const { samples, pendingCount } = useServiceTimes(eventId, uid)
  const now = useNow(250)

  const [truckId, setTruckId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [last, setLast] = useState<{ id: string; at: number } | null>(null)

  useWakeLock(true)

  const truck = trucks.find((t) => t.id === truckId) ?? null
  const mine = useMemo(
    () => samples.filter((s) => s.truckId === truckId && !s.undone),
    [samples, truckId],
  )
  const meanSec = mine.length ? mine.reduce((a, s) => a + s.durationMs, 0) / mine.length / 1000 : null

  if (authError) {
    return (
      <Screen title="Can't start">
        <p className="text-lg">
          This phone needs signal the first time it opens the app. Move somewhere with service
          and reload.
        </p>
      </Screen>
    )
  }
  if (loading || !uid) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" />
  const planning = (event as PlanningEvent | null)?.planning
  if (!planning?.serviceToken || planning.serviceToken !== token) {
    return (
      <Screen title="Link not recognised">
        <p className="text-lg">Ask the organizer for the service-timer card for today's event.</p>
      </Screen>
    )
  }

  if (!truck) {
    return (
      <div className="flex min-h-[100svh] flex-col bg-neutral-950 p-4 text-neutral-100">
        <h1 className="mb-1 text-2xl font-bold">Which truck are you timing?</h1>
        <p className="mb-4 text-sm text-neutral-400">
          Time one truck at a time. You can switch whenever you like.
        </p>
        {trucks.length === 0 && (
          <p className="text-neutral-400">No trucks set up yet. Ask the organizer.</p>
        )}
        <div className="grid gap-3">
          {trucks.map((t) => {
            const n = samples.filter((s) => s.truckId === t.id && !s.undone).length
            return (
              <button
                key={t.id}
                onClick={() => setTruckId(t.id)}
                className="flex items-center justify-between rounded-xl bg-neutral-800 px-5 py-5 text-left text-2xl font-bold active:bg-neutral-700"
              >
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 text-base font-semibold text-neutral-400">{n} timed</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const running = startedAt !== null
  const elapsed = running ? Math.max(0, now - startedAt) : 0
  const canUndo = last !== null && now - last.at < UNDO_MS

  const press = () => {
    if (!running) {
      setStartedAt(Date.now())
      buzz(35)
      return
    }
    const duration = Date.now() - startedAt
    setStartedAt(null)
    // A double press, not a customer.
    if (duration < 1000) return
    const id = recordServiceTime(eventId!, truck.id, duration, uid)
    setLast({ id, at: Date.now() })
    buzz([30, 40, 30])
  }

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-neutral-950 select-none">
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => {
            setTruckId(null)
            setStartedAt(null)
          }}
          className="min-w-0 text-left"
        >
          <div className="truncate text-base font-semibold text-neutral-100">{truck.name} ▾</div>
          <div className="truncate text-xs text-neutral-400">
            {mine.length} timed
            {meanSec !== null && <> · mean {formatSec(meanSec)}</>}
            {mine.length < MIN_SAMPLES && <> · {MIN_SAMPLES - mine.length} more needed</>}
          </div>
        </button>
        <div
          className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
            pendingCount === 0 ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${pendingCount === 0 ? 'bg-emerald-400' : 'bg-amber-400'}`}
          />
          {pendingCount === 0 ? 'Synced' : `${pendingCount} waiting`}
        </div>
      </header>

      <button
        onClick={press}
        className={`flex flex-1 flex-col items-center justify-center gap-2 border-4 ${
          running
            ? 'border-sky-300 bg-sky-700 active:bg-sky-500'
            : 'border-emerald-400 bg-emerald-600 active:bg-emerald-400'
        }`}
      >
        <span className="text-7xl font-black tracking-tight text-white">
          {running ? 'DONE' : 'START'}
        </span>
        <span className="px-4 text-center text-xl font-semibold text-white/90">
          {running
            ? `${formatSec(elapsed / 1000)} · tap when they walk away with food`
            : 'tap when a customer reaches the window'}
        </span>
      </button>

      <footer className="flex shrink-0 gap-2 p-2">
        <button
          onClick={() => setStartedAt(null)}
          disabled={!running}
          className="flex-1 rounded-lg bg-neutral-800 py-3 text-lg font-bold text-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          CANCEL
        </button>
        <button
          onClick={() => {
            if (!last) return
            undoServiceTime(eventId!, last.id)
            setLast(null)
            buzz([20, 40, 20])
          }}
          disabled={!canUndo}
          className="flex-1 rounded-lg bg-neutral-800 py-3 text-lg font-bold text-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          UNDO LAST
        </button>
      </footer>
    </div>
  )
}

function formatSec(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
