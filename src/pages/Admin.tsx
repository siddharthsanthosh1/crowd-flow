import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useActions, useEventConfig, useSiteMap } from '../lib/data'
import { useAdminAccess, rememberSecret } from '../lib/useAdminAccess'
import {
  archiveAction,
  markAsDemo,
  archiveCheckpoint,
  archiveZone,
  createEvent,
  duplicateEvent,
  saveCheckpoint,
  saveCheckpointOrder,
  saveAction,
  saveEventMeta,
  saveSiteMap,
  saveZone,
  saveZoneOrder,
  saveZonePosition,
} from '../lib/admin'
import { createDemoEvent } from '../lib/demo'
import {
  DEFAULT_SCALE,
  LIVE_MS,
  clearSimulation,
  countLiveTaps,
  planFestival,
  runSimulation,
} from '../lib/simulate'
import type { SimHandle, SimProgress } from '../lib/simulate'
import { QR } from '../components/QR'
import { newId } from '../lib/ids'
import { rememberEvent, rememberedEvents } from '../lib/localEvents'
import { adminUrl, dashboardUrl, printUrl, vendorUrl, volunteerUrl } from '../lib/urls'
import { OUTSIDE } from '../types'
import { imageToDataUrl } from '../lib/imageResize'
import { SiteMap } from '../components/SiteMap'
import type { Checkpoint, SuggestedAction, Zone } from '../types'
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

      <section className="mb-8 rounded-xl border border-neutral-800 p-4">
        <h2 className="mb-1 font-semibold">Demo event</h2>
        <p className="mb-3 text-sm text-neutral-400">
          Four zones and four checkpoints matching a plausible park layout, ready to hand
          someone a phone.
        </p>
        <button
          disabled={busy}
          onClick={() => run(() => createDemoEvent(uid), 'Demo — Morrisville Diwali Festival')}
          className={btnPlain}
        >
          Create demo event
        </button>
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
  const { event, zones, checkpoints, loading, notFound } = useEventConfig(eventId, uid)
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
      <h1 className="mt-2 mb-3 text-2xl font-bold">{event.name}</h1>
      <Link
        to={`/admin/${eventId}/checklist`}
        className="mb-6 inline-block rounded-lg border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-200"
      >
        Morning-of checklist →
      </Link>

      <EventMetaEditor eventId={eventId!} name={event.name} date={event.date} venue={event.venue} />
      <ZonesEditor eventId={eventId!} zones={zones} />
      <CheckpointsEditor eventId={eventId!} zones={zones} checkpoints={checkpoints} />
      <SiteMapEditor eventId={eventId!} uid={uid} zones={zones} />
      <ActionsEditor eventId={eventId!} uid={uid} zones={zones} />
      <LinksSection eventId={eventId!} checkpoints={checkpoints} />
      <VendorLinksSection eventId={eventId!} zones={zones} />
      <SimulatorSection eventId={eventId!} uid={uid} event={event} zones={zones} checkpoints={checkpoints} />
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

/**
 * Upload a site map and place each zone on it by tapping. Stored as a shrunken
 * data URL in its own document, so no Cloud Storage bucket is involved.
 */
function SiteMapEditor({
  eventId,
  uid,
  zones,
}: {
  eventId: string
  uid: string
  zones: Zone[]
}) {
  const { siteMap } = useSiteMap(eventId, uid)
  const [placing, setPlacing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await saveSiteMap(eventId, await imageToDataUrl(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that image')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Site map">
      <p className="mb-3 text-sm text-neutral-400">
        Optional. Upload a picture of the park layout, then tap a zone below and tap the map
        to place it. The dashboard draws each zone as a circle sized by how full it is.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button disabled={busy} className={btnPlain} onClick={() => fileRef.current?.click()}>
        {busy ? 'Working…' : siteMap ? 'Replace map' : 'Upload map'}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {siteMap && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {zones.map((z) => (
              <button
                key={z.id}
                onClick={() => setPlacing(placing === z.id ? null : z.id)}
                className={`${btn} text-sm ${
                  placing === z.id ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {z.mapX === undefined ? 'Place' : 'Move'} {z.name}
              </button>
            ))}
          </div>
          <p className="mt-2 mb-2 text-xs text-neutral-500">
            {placing
              ? 'Now tap the spot on the map.'
              : 'Pick a zone above, then tap the map.'}
          </p>
          <SiteMap
            imageUrl={siteMap}
            zones={zones}
            occupancy={new Map(zones.map((z) => [z.id, 0]))}
            placingZoneId={placing}
            onPlace={(x, y) => {
              if (!placing) return
              saveZonePosition(eventId, placing, x, y).catch(console.error)
              setPlacing(null)
            }}
          />
        </>
      )}
    </Section>
  )
}

/** "When Food Court is over 85%, show: open the second queue lane." */
function ActionsEditor({
  eventId,
  uid,
  zones,
}: {
  eventId: string
  uid: string
  zones: Zone[]
}) {
  const { actions } = useActions(eventId, uid)

  const add = () =>
    saveAction(eventId, {
      id: newId(),
      zoneId: zones[0]?.id ?? '',
      thresholdPct: 85,
      text: 'Open the overflow area',
      order: actions.length,
    }).catch(console.error)

  return (
    <Section title="Suggested actions">
      <p className="mb-3 text-sm text-neutral-400">
        Shown on the dashboard alert when a zone passes the threshold, so whoever is holding
        the tablet does not have to decide what to do in the moment.
      </p>
      <div className="grid gap-2">
        {actions.map((a: SuggestedAction) => (
          <div key={a.id} className="grid gap-2 rounded-lg border border-neutral-800 p-3">
            <div className="flex items-center gap-2">
              <select
                className={input}
                value={a.zoneId}
                onChange={(e) => saveAction(eventId, { ...a, zoneId: e.target.value })}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-sm text-neutral-400">over</span>
              <input
                type="number"
                min={1}
                max={100}
                className={`${input} w-20`}
                defaultValue={a.thresholdPct}
                onBlur={(e) =>
                  saveAction(eventId, {
                    ...a,
                    thresholdPct: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 85))),
                  })
                }
              />
              <span className="shrink-0 text-sm text-neutral-400">%</span>
            </div>
            <input
              className={input}
              defaultValue={a.text}
              onBlur={(e) => saveAction(eventId, { ...a, text: e.target.value })}
            />
            <button
              className={`${btn} bg-red-900 text-red-200`}
              onClick={() => archiveAction(eventId, a.id).catch(console.error)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className={`${btnPlain} mt-3`} disabled={zones.length === 0}>
        Add action
      </button>
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

/**
 * One read-only link per area, for the food vendors. They existed before this
 * section did - they just had to be assembled by hand from a zone's document
 * id, which is not a thing anyone should have to do on the morning of an event.
 */
function VendorLinksSection({ eventId, zones }: { eventId: string; zones: Zone[] }) {
  const [showing, setShowing] = useState<string | null>(null)

  return (
    <Section title="Vendor links">
      <p className="mb-3 text-sm text-neutral-400">
        A read-only page for one area, safe to hand to a food vendor or a stage manager.
        It shows how busy their area is and nothing else - no counts for anywhere else, no
        organizer actions.
      </p>
      {zones.length === 0 && <p className="text-sm text-neutral-500">Add a zone first.</p>}
      <div className="grid gap-3">
        {zones.map((z) => {
          const url = vendorUrl(eventId, z.id)
          return (
            <div key={z.id} className="rounded-lg border border-neutral-800 p-3">
              <LinkRow label={z.name} url={url} />
              <button
                onClick={() => setShowing(showing === z.id ? null : z.id)}
                className="mt-2 text-xs text-neutral-400 underline"
              >
                {showing === z.id ? 'Hide QR' : 'Show QR'}
              </button>
              {showing === z.id && (
                <div className="mt-2 inline-block rounded bg-white p-2">
                  <QR value={url} size={128} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/**
 * Generate a festival, for showing the dashboard to people when there is no
 * crowd outside. Demo events only - see the note on runSimulation.
 */
function SimulatorSection({
  eventId,
  uid,
  event,
  zones,
  checkpoints,
}: {
  eventId: string
  uid: string
  event: { name: string; demo?: boolean }
  zones: Zone[]
  checkpoints: Checkpoint[]
}) {
  const [progress, setProgress] = useState<SimProgress | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const handle = useRef<SimHandle | null>(null)

  // Stop the trickle if the organizer navigates away mid-demo.
  useEffect(() => () => handle.current?.stop(), [])

  const plannedTaps = useMemo(
    () =>
      zones.length && checkpoints.length
        ? planFestival(zones, checkpoints, { scale }).taps.length
        : 0,
    [zones, checkpoints, scale],
  )

  if (!event.demo) {
    return (
      <Section title="Demo simulator">
        <p className="mb-3 text-sm text-neutral-400">
          Generates a realistic three-hour festival so the dashboard has something to show
          when there is no crowd outside. Only available on a demo event, because generated
          taps are written into the same log as real ones and are then indistinguishable
          from them.
        </p>
        <p className="mb-3 text-sm text-amber-400">
          This event is not marked as a demo. Marking it puts a permanent SIMULATED badge on
          its dashboard. Never do this to an event you intend to count people at.
        </p>
        <button
          className={btnPlain}
          onClick={() => {
            if (
              confirm(
                `Mark "${event.name}" as a demo event?\n\nIts dashboard will show a SIMULATED badge from now on, and this cannot be undone from the app. Do not do this to a real event.`,
              )
            ) {
              markAsDemo(eventId).catch((e) => setStatus(String(e)))
            }
          }}
        >
          Mark as demo event
        </button>
        {status && <p className="mt-2 text-sm text-red-400">{status}</p>}
      </Section>
    )
  }

  const running = progress !== null && progress.phase !== 'done'

  const start = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const existing = await countLiveTaps(eventId)
      if (existing > 0) {
        setStatus(
          `This event already holds ${existing.toLocaleString()} taps. Clear the simulation first, or the two festivals will be added together.`,
        )
        setBusy(false)
        return
      }
      handle.current = await runSimulation({
        eventId,
        uid,
        zones,
        checkpoints,
        scale,
        onProgress: setProgress,
      })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The simulation could not start')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Demo simulator">
      <p className="mb-2 text-sm text-neutral-400">
        Writes 2h40m of festival instantly, then plays the last 20 minutes out live over{' '}
        {LIVE_MS / 60_000} minutes so the dashboard moves while people are watching it. A
        light trickle keeps running afterwards so forecasts have something to be scored
        against.
      </p>
      <label className="mb-2 grid gap-1 text-sm text-neutral-400">
        Crowd size
        <select
          className={input}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          disabled={running}
        >
          <option value={1}>Full size - the crowd the capacities were set for</option>
          <option value={0.5}>Half - cheaper rehearsal, no zone reaches its limit</option>
          <option value={0.25}>Quarter - cheapest, for checking it works at all</option>
        </select>
      </label>
      <p className="mb-3 text-xs text-neutral-500">
        About {plannedTaps.toLocaleString()} taps, which is {plannedTaps.toLocaleString()}{' '}
        Firestore writes - and as many reads every time the dashboard is opened. Be on the
        Blaze plan before running this.
        {scale < 1 && (
          <>
            {' '}
            Capacities do not shrink with the crowd, so at this size nothing crosses 85% and
            the alert banner will not appear. Use full size for the real demo.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <button disabled={busy || running} onClick={start} className={btnPrimary}>
          {running ? 'Running…' : 'Simulate'}
        </button>
        {running && (
          <button
            className={btnPlain}
            onClick={() => {
              handle.current?.stop()
              setProgress((p) => (p ? { ...p, phase: 'done', message: 'Stopped.' } : null))
            }}
          >
            Stop
          </button>
        )}
        <button
          disabled={busy}
          className={`${btn} bg-red-900 text-red-200`}
          onClick={async () => {
            if (!confirm('Mark every tap this browser wrote to this event as undone?')) return
            // Stop first: a trickle still running would write new taps behind
            // the clear and leave the event half-simulated.
            handle.current?.stop()
            setBusy(true)
            try {
              await clearSimulation({ eventId, uid, onProgress: setStatus })
              setProgress(null)
            } catch (e) {
              setStatus(e instanceof Error ? e.message : 'Could not clear the simulation')
            } finally {
              setBusy(false)
            }
          }}
        >
          Clear simulation
        </button>
      </div>

      {progress && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-emerald-500 transition-[width]"
              style={{ width: `${Math.min(100, (progress.written / Math.max(1, progress.total)) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-sm text-neutral-300">{progress.message}</p>
        </div>
      )}
      {status && <p className="mt-2 text-sm text-amber-400">{status}</p>}

      <p className="mt-3 text-xs text-neutral-500">
        Clear only reaches taps written by this browser, because that is the only thing the
        rules let it undo. Run Simulate and Clear from the same browser.
      </p>
    </Section>
  )
}
