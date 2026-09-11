import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig } from '../lib/data'
import { useAdminAccess, rememberSecret } from '../lib/useAdminAccess'
import {
  archiveCheckpoint,
  archiveZone,
  createEvent,
  duplicateEvent,
  saveCheckpoint,
  saveCheckpointOrder,
  saveEventMeta,
  saveZone,
  saveZoneOrder,
} from '../lib/admin'
import { newId } from '../lib/ids'
import { rememberEvent, rememberedEvents } from '../lib/localEvents'
import { adminUrl, dashboardUrl, printUrl, volunteerUrl } from '../lib/urls'
import { OUTSIDE } from '../types'
import type { Checkpoint, Zone } from '../types'
import { Screen } from '../components/Screen'

const input =
  'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100'
const btn = 'rounded-lg px-4 py-2 font-semibold'
const btnPrimary = `${btn} bg-emerald-600 text-white`
const btnPlain = `${btn} bg-neutral-800 text-neutral-100`

/* ------------------------------------------------------------------ */
/* /admin - create an event, or jump back into one this device made.    */
/* ------------------------------------------------------------------ */

export function AdminHome() {
  const { uid } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('Morrisville Diwali Festival')
  const [date, setDate] = useState('2026-10-17')
  const [venue, setVenue] = useState('Morrisville Community Park')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const known = rememberedEvents()

  const run = async (fn: () => Promise<{ eventId: string; secret: string }>, label: string) => {
    setBusy(true)
    setError(null)
    try {
      const { eventId, secret } = await fn()
      rememberSecret(eventId, secret)
      rememberEvent({ id: eventId, name: label })
      navigate(`/admin/${eventId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the event')
      setBusy(false)
    }
  }

  if (!uid) return <Screen title="Loading…" />

  return (
    <div className="mx-auto max-w-xl p-4 text-neutral-100">
      <h1 className="mb-6 text-2xl font-bold">CrowdFlow admin</h1>

      <section className="mb-8 rounded-xl border border-neutral-800 p-4">
        <h2 className="mb-3 font-semibold">New event</h2>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm text-neutral-400">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm text-neutral-400">
            Date
            <input
              type="date"
              className={input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-neutral-400">
            Venue
            <input className={input} value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
          <button
            disabled={busy}
            onClick={() => run(() => createEvent({ name, date, venue }, uid), name)}
            className={btnPrimary}
          >
            Create event
          </button>
        </div>
      </section>

      {error && <p className="mb-6 text-red-400">{error}</p>}

      {known.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Events created on this device</h2>
          <ul className="grid gap-2">
            {known.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/admin/${e.id}`}
                  className="block rounded-lg border border-neutral-800 p-3 hover:border-neutral-600"
                >
                  {e.name}
                  <span className="block font-mono text-xs text-neutral-500">{e.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* /admin/:eventId - the setup page used the day before the event.      */
/* ------------------------------------------------------------------ */

export function AdminEvent() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, loading, notFound } = useEventConfig(eventId)
  const { status, error, unlock } = useAdminAccess(eventId, uid)
  const [secretInput, setSecretInput] = useState('')

  if (loading || !uid || status === 'checking') return <Screen title="Loading…" />
  if (notFound || !event) return <Screen title="Event not found" />

  if (status === 'no') {
    return (
      <Screen title="Admin secret required">
        <p className="mb-4">Enter the secret shown when this event was created.</p>
        <input
          className={`${input} mb-3 text-center font-mono`}
          placeholder="XXXX-XXXX-XXXX"
          value={secretInput}
          onChange={(e) => setSecretInput(e.target.value)}
        />
        <button onClick={() => unlock(secretInput)} className={`${btnPrimary} w-full`}>
          Unlock
        </button>
        {error && <p className="mt-3 text-red-400">{error}</p>}
      </Screen>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4 pb-24 text-neutral-100">
      <Link to="/admin" className="text-sm text-neutral-400">
        ← All events
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold">{event.name}</h1>

      <EventMetaEditor eventId={eventId!} name={event.name} date={event.date} venue={event.venue} />
      <ZonesEditor eventId={eventId!} zones={zones} />
      <CheckpointsEditor eventId={eventId!} zones={zones} checkpoints={checkpoints} />
      <LinksSection eventId={eventId!} checkpoints={checkpoints} />
      <SecretSection eventId={eventId!} />
      <DuplicateSection eventId={eventId!} event={event} zones={zones} checkpoints={checkpoints} uid={uid} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 rounded-xl border border-neutral-800 p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function EventMetaEditor({
  eventId,
  name,
  date,
  venue,
}: {
  eventId: string
  name: string
  date: string
  venue: string
}) {
  const save = (patch: Partial<{ name: string; date: string; venue: string }>) =>
    saveEventMeta(eventId, { name, date, venue, ...patch }).catch(console.error)

  return (
    <Section title="Event details">
      <div className="grid gap-3">
        <input
          className={input}
          defaultValue={name}
          onBlur={(e) => save({ name: e.target.value })}
        />
        <input
          type="date"
          className={input}
          defaultValue={date}
          onBlur={(e) => save({ date: e.target.value })}
        />
        <input
          className={input}
          defaultValue={venue}
          onBlur={(e) => save({ venue: e.target.value })}
        />
      </div>
    </Section>
  )
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list]
  const target = index + delta
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function ZonesEditor({ eventId, zones }: { eventId: string; zones: Zone[] }) {
  const add = () =>
    saveZone(eventId, {
      id: newId(),
      name: 'New zone',
      capacity: 500,
      order: zones.length,
    }).catch(console.error)

  return (
    <Section title="Zones">
      <div className="grid gap-2">
        {zones.map((z, i) => (
          <div key={z.id} className="flex items-center gap-2">
            <input
              className={input}
              defaultValue={z.name}
              onBlur={(e) => saveZone(eventId, { ...z, name: e.target.value })}
            />
            <input
              type="number"
              min={1}
              className={`${input} w-28`}
              defaultValue={z.capacity}
              onBlur={(e) =>
                saveZone(eventId, {
                  ...z,
                  capacity: Math.max(1, Math.round(Number(e.target.value) || 1)),
                })
              }
            />
            <button
              className={btnPlain}
              onClick={() => saveZoneOrder(eventId, move(zones, i, -1))}
            >
              ↑
            </button>
            <button
              className={btnPlain}
              onClick={() => saveZoneOrder(eventId, move(zones, i, 1))}
            >
              ↓
            </button>
            <button
              className={`${btn} bg-red-900 text-red-200`}
              onClick={() => {
                if (confirm(`Remove "${z.name}"? Its taps stay in the log.`))
                  archiveZone(eventId, z.id).catch(console.error)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className={`${btnPlain} mt-3`}>
        Add zone
      </button>
    </Section>
  )
}

function CheckpointsEditor({
  eventId,
  zones,
  checkpoints,
}: {
  eventId: string
  zones: Zone[]
  checkpoints: Checkpoint[]
}) {
  const add = () =>
    saveCheckpoint(eventId, {
      id: newId(),
      name: 'New checkpoint',
      fromZoneId: OUTSIDE,
      toZoneId: zones[0]?.id ?? OUTSIDE,
      token: newId(),
      order: checkpoints.length,
    }).catch(console.error)

  const options = [{ id: OUTSIDE, name: 'Outside' }, ...zones]

  return (
    <Section title="Checkpoints">
      <p className="mb-3 text-sm text-neutral-400">
        IN counts someone moving <em>from</em> → <em>to</em>. OUT counts the reverse.
      </p>
      <div className="grid gap-3">
        {checkpoints.map((c, i) => (
          <div key={c.id} className="grid gap-2 rounded-lg border border-neutral-800 p-3">
            <input
              className={input}
              defaultValue={c.name}
              onBlur={(e) => saveCheckpoint(eventId, { ...c, name: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <select
                className={input}
                value={c.fromZoneId}
                onChange={(e) => saveCheckpoint(eventId, { ...c, fromZoneId: e.target.value })}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-neutral-400">→</span>
              <select
                className={input}
                value={c.toZoneId}
                onChange={(e) => saveCheckpoint(eventId, { ...c, toZoneId: e.target.value })}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                className={btnPlain}
                onClick={() => saveCheckpointOrder(eventId, move(checkpoints, i, -1))}
              >
                ↑
              </button>
              <button
                className={btnPlain}
                onClick={() => saveCheckpointOrder(eventId, move(checkpoints, i, 1))}
              >
                ↓
              </button>
              <button
                className={`${btn} bg-red-900 text-red-200`}
                onClick={() => {
                  if (confirm(`Remove "${c.name}"? Its taps stay in the log.`))
                    archiveCheckpoint(eventId, c.id).catch(console.error)
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className={`${btnPlain} mt-3`}>
        Add checkpoint
      </button>
    </Section>
  )
}

function LinksSection({
  eventId,
  checkpoints,
}: {
  eventId: string
  checkpoints: Checkpoint[]
}) {
  return (
    <Section title="Links and QR cards">
      <div className="mb-4 grid gap-2">
        <LinkRow label="Dashboard" url={dashboardUrl(eventId)} />
        <LinkRow label="This admin page" url={adminUrl(eventId)} />
      </div>
      <a href={printUrl(eventId)} target="_blank" rel="noreferrer" className={btnPrimary}>
        Print QR cards ({checkpoints.length + 1})
      </a>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-neutral-400">
          Volunteer links (for testing without printing)
        </summary>
        <div className="mt-2 grid gap-2">
          {checkpoints.map((c) => (
            <LinkRow key={c.id} label={c.name} url={volunteerUrl(eventId, c.token)} />
          ))}
        </div>
      </details>
    </Section>
  )
}

/** The secret lives only on this device. Written down, it unlocks another one. */
function SecretSection({ eventId }: { eventId: string }) {
  const [shown, setShown] = useState(false)
  const secret = localStorage.getItem(`crowdflow:secret:${eventId}`)

  return (
    <Section title="Admin secret">
      <p className="mb-3 text-sm text-neutral-400">
        Write this down. It is the only way to edit this event from another device, and
        it is not recoverable.
      </p>
      {shown ? (
        <code className="block rounded-lg bg-neutral-900 px-3 py-2 text-lg tracking-widest">
          {secret ?? 'Not stored on this device'}
        </code>
      ) : (
        <button className={btnPlain} onClick={() => setShown(true)}>
          Show secret
        </button>
      )}
    </Section>
  )
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 truncate text-neutral-400">{label}</span>
      <a href={url} className="min-w-0 flex-1 truncate text-emerald-400" target="_blank" rel="noreferrer">
        {url}
      </a>
      <button className={btnPlain} onClick={() => navigator.clipboard?.writeText(url)}>
        Copy
      </button>
    </div>
  )
}

function DuplicateSection({
  event,
  zones,
  checkpoints,
  uid,
}: {
  eventId: string
  event: { name: string; date: string; venue: string }
  zones: Zone[]
  checkpoints: Checkpoint[]
  uid: string
}) {
  const navigate = useNavigate()
  const [name, setName] = useState(`${event.name} (copy)`)
  const [date, setDate] = useState(event.date)
  const [busy, setBusy] = useState(false)

  return (
    <Section title="Duplicate for next year">
      <p className="mb-3 text-sm text-neutral-400">
        Copies the zones and checkpoints into a new event with fresh QR tokens. Old cards
        stop working; the layout survives.
      </p>
      <div className="grid gap-2">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="date"
          className={input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          disabled={busy}
          className={btnPlain}
          onClick={async () => {
            setBusy(true)
            try {
              const { eventId: newEventId, secret } = await duplicateEvent(
                { name, date, venue: event.venue },
                uid,
                zones,
                checkpoints,
              )
              rememberSecret(newEventId, secret)
              rememberEvent({ id: newEventId, name })
              navigate(`/admin/${newEventId}`)
            } catch (e) {
              console.error(e)
              setBusy(false)
            }
          }}
        >
          Duplicate
        </button>
      </div>
    </Section>
  )
}
