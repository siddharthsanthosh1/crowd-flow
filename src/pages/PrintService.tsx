import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig } from '../lib/data'
import { serviceUrl } from '../lib/planning/data'
import type { PlanningEvent } from '../lib/planning/types'
import { Screen } from '../components/Screen'
import { Card } from './Print'

/** The service-timer card, in the same letter-size style as the checkpoint cards. */
export function PrintService() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, loading, notFound } = useEventConfig(eventId, uid)

  if (loading || !uid) return <Screen title="Loading…" />
  if (notFound || !event) return <Screen title="Event not found" />
  const token = (event as PlanningEvent).planning?.serviceToken
  if (!token) return <Screen title="No service-timer card yet">Create it on the admin page first.</Screen>

  return (
    <div className="bg-white text-black">
      <div className="no-print sticky top-0 flex items-center justify-between gap-3 border-b border-neutral-300 bg-white p-3">
        <span className="text-sm text-neutral-700">1 card · print at letter size, portrait</span>
        <button onClick={() => window.print()} className="rounded-lg bg-black px-4 py-2 font-bold text-white">
          Print
        </button>
      </div>
      <Card
        eventLine={`${event.name} · ${event.date} · ${event.venue}`}
        title="Food truck timer"
        url={serviceUrl(eventId!, token)}
        lines={[
          { label: 'Press START when a customer reaches the window', value: 'START' },
          { label: 'Press DONE when they walk away with food', value: 'DONE' },
        ]}
      />
    </div>
  )
}
