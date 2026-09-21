import { useState } from 'react'
import { QR } from './QR'
import { newId } from '../lib/ids'
import {
  archiveTruck,
  ensureServiceToken,
  saveTruck,
  savePlanning,
  serviceUrl,
  useServiceTimes,
  useTrucks,
} from '../lib/planning/data'
import { MIN_SAMPLES, truckRates } from '../lib/planning/queue'
import { DEFAULT_MISS_PROB, DEFAULT_TARGET_WAIT_MIN } from '../lib/planning/types'
import type { PlanningEvent } from '../lib/planning/types'
import type { Zone } from '../types'

const input =
  'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100'
const btn = 'rounded-lg px-4 py-2 font-semibold'
const btnPlain = `${btn} bg-neutral-800 text-neutral-100`

/**
 * The planning layer's switch and its inputs. The switch is what the dashboard
 * and report read; `?planning=1` on either page overrides it for one visit.
 */
export function PlanningAdmin({
  event,
  uid,
  zones,
}: {
  event: PlanningEvent
  uid: string
  zones: Zone[]
}) {
  const eventId = event.id
  const planning = event.planning ?? {}
  const enabled = planning.enabled === true
  const save = (patch: Parameters<typeof savePlanning>[1]) =>
    savePlanning(eventId, patch).catch(console.error)

  return (
    <section className="mb-8 rounded-xl border border-neutral-800 p-4">
      <h2 className="mb-3 font-semibold">Planning features</h2>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        <span className="font-semibold">{enabled ? 'On' : 'Off'}</span>
        <span className="text-sm text-neutral-400">
          Shows the planning report, attendance bands, consistency checks and the second
          forecaster on the dashboard and report.
        </span>
      </label>
      <p className="mt-2 text-xs text-neutral-500">
        Add <code>?planning=1</code> to a dashboard or report link to show it for one visit
        without changing this switch, or <code>?planning=0</code> to hide it.
      </p>

      {enabled && (
        <div className="mt-4 grid gap-5">
          <Inputs eventId={eventId} planning={planning} zones={zones} save={save} />
          <Trucks eventId={eventId} uid={uid} />
          <ServiceCard event={event} />
        </div>
      )}
    </section>
  )
}

function Inputs({
  planning,
  zones,
  save,
}: {
  eventId: string
  planning: NonNullable<PlanningEvent['planning']>
  zones: Zone[]
  save: (patch: Parameters<typeof savePlanning>[1]) => void
}) {
  /** A blank box clears the value; the report then says it is missing. */
  const pctField = (value: number | undefined) =>
    value === undefined ? '' : String(Math.round(value * 1000) / 10)
  const parse = (s: string) => (s.trim() === '' ? null : Number(s))

  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-semibold text-neutral-300">Organizer inputs</h3>
      <Field label="Food court zone" hint="Arrivals into this zone feed the food-truck model.">
        <select
          className={input}
          value={planning.foodZoneId ?? ''}
          onChange={(e) => save({ foodZoneId: e.target.value || null })}
        >
          <option value="">Choose a zone…</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Share of food-court visitors who order (%)"
        hint="Your estimate. No default: until you enter one the report shows 50%, 75% and 100% side by side."
      >
        <input
          type="number"
          min={1}
          max={100}
          className={input}
          placeholder="not set"
          defaultValue={pctField(planning.orderShare)}
          onBlur={(e) => {
            const v = parse(e.target.value)
            save({ orderShare: v === null || !(v > 0) ? null : Math.min(100, v) / 100 })
          }}
        />
      </Field>
      <Field label="Longest acceptable food wait (minutes)" hint={`Default ${DEFAULT_TARGET_WAIT_MIN}.`}>
        <input
          type="number"
          min={1}
          className={input}
          defaultValue={planning.targetWaitMin ?? DEFAULT_TARGET_WAIT_MIN}
          onBlur={(e) => {
            const v = parse(e.target.value)
            save({ targetWaitMin: v === null || !(v > 0) ? null : v })
          }}
        />
      </Field>
      <Field
        label="Chance a volunteer misses one person (%)"
        hint={`An assumption, default ${DEFAULT_MISS_PROB * 100}%. Sets the ± band on every count.`}
      >
        <input
          type="number"
          min={0}
          max={50}
          step={0.5}
          className={input}
          defaultValue={pctField(planning.missProb ?? DEFAULT_MISS_PROB)}
          onBlur={(e) => {
            const v = parse(e.target.value)
            save({ missProb: v === null || v < 0 ? null : Math.min(50, v) / 100 })
          }}
        />
      </Field>
      <Field
        label="People on site per staff member"
        hint="Your target ratio. No default: the staffing table stays empty until you enter one."
      >
        <input
          type="number"
          min={1}
          className={input}
          placeholder="not set"
          defaultValue={planning.staffRatio ?? ''}
          onBlur={(e) => {
            const v = parse(e.target.value)
            save({ staffRatio: v === null || !(v > 0) ? null : v })
          }}
        />
      </Field>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-neutral-300">{label}</span>
      {children}
      <span className="text-xs text-neutral-500">{hint}</span>
    </label>
  )
}

function Trucks({ eventId, uid }: { eventId: string; uid: string }) {
  const { trucks } = useTrucks(eventId, uid)
  const { samples } = useServiceTimes(eventId, uid)
  const rates = truckRates(trucks, samples)

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Food trucks</h3>
      <div className="grid gap-2">
        {rates.map(({ truck, samples: n, meanSec }) => (
          <div key={truck.id} className="flex items-center gap-2">
            <input
              className={input}
              defaultValue={truck.name}
              onBlur={(e) => saveTruck(eventId, { ...truck, name: e.target.value }).catch(console.error)}
            />
            <span className="w-36 shrink-0 text-right text-xs text-neutral-400">
              {meanSec !== null
                ? `${n} timed · ${Math.round(meanSec)}s avg`
                : `${n} of ${MIN_SAMPLES} timed`}
            </span>
            <button
              className={`${btn} bg-red-900 text-red-200`}
              onClick={() => {
                if (confirm(`Remove "${truck.name}"? Its service times stay in the log.`))
                  archiveTruck(eventId, truck.id).catch(console.error)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        className={`${btnPlain} mt-2`}
        onClick={() =>
          saveTruck(eventId, { id: newId(), name: `Truck ${trucks.length + 1}`, order: trucks.length }).catch(
            console.error,
          )
        }
      >
        Add truck
      </button>
    </div>
  )
}

function ServiceCard({ event }: { event: PlanningEvent }) {
  const token = event.planning?.serviceToken
  const [busy, setBusy] = useState(false)
  if (!token) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Service-timer card</h3>
        <button
          className={btnPlain}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            ensureServiceToken(event).catch(console.error).finally(() => setBusy(false))
          }}
        >
          Create the service-timer card
        </button>
      </div>
    )
  }
  const url = serviceUrl(event.id, token)
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Service-timer card</h3>
      <p className="mb-2 text-xs text-neutral-400">
        For the food-path volunteer, for about 30 minutes before the rush. START when a customer
        reaches the window, DONE when they walk away with food.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded bg-white p-2">
          <QR value={url} size={128} />
        </div>
        <div className="grid min-w-0 flex-1 gap-2 text-sm">
          <a href={url} target="_blank" rel="noreferrer" className="truncate text-emerald-400">
            {url}
          </a>
          <a
            href={`/print/${event.id}/service`}
            target="_blank"
            rel="noreferrer"
            className="w-fit rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white"
          >
            Print card
          </a>
        </div>
      </div>
    </div>
  )
}
