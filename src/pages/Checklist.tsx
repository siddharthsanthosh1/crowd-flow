import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig } from '../lib/data'
import { dashboardUrl, printUrl } from '../lib/urls'
import { Screen } from '../components/Screen'

type Item = { id: string; title: string; detail: string }

/**
 * The morning of the event, on a phone, probably in a car park.
 *
 * Every item here is something that has a specific way of going wrong and no
 * way of being noticed once the gates open: a quota that runs out at 7 p.m., a
 * checkpoint whose card never got printed, a volunteer who never read the
 * briefing. The list is static on purpose - it is a checklist, not a feature -
 * and the ticks live in this browser, so it is the organizer's own copy.
 */
const ITEMS: Item[] = [
  {
    id: 'blaze',
    title: 'Firebase is on the Blaze plan, with a budget alert set',
    detail:
      'The free plan stops accepting writes after about 20,000 in a day, and a tap is a write. If it runs out mid-event the volunteers keep tapping and nothing is recorded. Check the plan in the Firebase console, and set a budget alert while you are there.',
  },
  {
    id: 'cards',
    title: 'Every checkpoint has its printed card, taped up at the right post',
    detail:
      'Check the card against the post: the card names the direction, and a card at the wrong gate counts people the wrong way all night.',
  },
  {
    id: 'dashboard',
    title: 'The dashboard opens on the organizer phone, and is unlocked',
    detail:
      'Open it and tap the lock in the header with the admin secret. Forecasts are only recorded by an unlocked dashboard, so if nobody unlocks one there is no forecast history and nothing to score.',
  },
  {
    id: 'briefing',
    title: 'The volunteer briefing has gone out, and someone is meeting them',
    detail:
      'One minute of reading, sent the day before. Bring a printed copy for whoever turns up not having read it.',
  },
  {
    id: 'spare',
    title: 'A spare charged phone, and a battery pack per volunteer',
    detail:
      'A dead phone is a checkpoint that goes silent, and a silent checkpoint quietly corrupts the count for the zone behind it. The screen stays on for the whole shift, which is hard on a battery.',
  },
  {
    id: 'signal',
    title: 'Each volunteer opened their link once while they had signal',
    detail:
      'Signing in has to reach Firebase once. After that the phone works with no bars at all, but a phone that has never opened the app cannot start offline.',
  },
  {
    id: 'reset',
    title: 'Everyone knows who resets a zone, and when',
    detail:
      'The count drifts all evening and never corrects itself. When an area visibly empties, reset it from its card on the dashboard. Agree beforehand who makes that call.',
  },
]

const key = (eventId: string) => `crowdflow:checklist:${eventId}`

export function Checklist() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, checkpoints, loading, notFound } = useEventConfig(eventId, uid)
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return eventId ? JSON.parse(localStorage.getItem(key(eventId)) ?? '{}') : {}
    } catch {
      return {} // a private window, or cleared site data
    }
  })

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(key(eventId!), JSON.stringify(next))
      } catch {
        /* a private window can refuse; the list still works for this session */
      }
      return next
    })
  }

  if (loading) return <Screen title="Loading…" />
  if (notFound) return <Screen title="Event not found" />

  const ticked = ITEMS.filter((i) => done[i.id]).length

  return (
    <div className="mx-auto min-h-[100svh] max-w-xl bg-neutral-950 p-4 pb-16 text-neutral-100">
      <Link to={`/admin/${eventId}`} className="text-sm text-neutral-400">
        ← {event?.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Before the gates open</h1>
      <p className="mt-1 mb-1 text-sm text-neutral-400">
        {event?.date} · {event?.venue} · {checkpoints.length} checkpoints
      </p>
      <p className="mb-6 text-sm text-neutral-500">
        {ticked} of {ITEMS.length} done. Ticks are saved in this browser only.
      </p>

      <ol className="grid gap-3">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                done[item.id]
                  ? 'border-emerald-700 bg-emerald-950/40'
                  : 'border-neutral-800 bg-neutral-900'
              }`}
            >
              <input
                type="checkbox"
                checked={!!done[item.id]}
                onChange={() => toggle(item.id)}
                className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-500"
              />
              <span className="min-w-0">
                <span
                  className={`block font-semibold ${
                    done[item.id] ? 'text-emerald-200 line-through' : 'text-neutral-100'
                  }`}
                >
                  {item.title}
                </span>
                <span className="mt-0.5 block text-sm text-neutral-400">{item.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-2 text-sm">
        <a href={dashboardUrl(eventId!)} className="text-emerald-400 underline" target="_blank" rel="noreferrer">
          Open the dashboard
        </a>
        <a href={printUrl(eventId!)} className="text-emerald-400 underline" target="_blank" rel="noreferrer">
          Print the QR cards
        </a>
      </div>
    </div>
  )
}
