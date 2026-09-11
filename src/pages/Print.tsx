import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { useEventConfig } from '../lib/data'
import { dashboardUrl, volunteerUrl } from '../lib/urls'
import { OUTSIDE } from '../types'
import { QR } from '../components/QR'
import { Screen } from '../components/Screen'

/**
 * One letter-size card per checkpoint, plus one for the dashboard.
 * Print from the browser; tape each card to its post.
 */
export function Print() {
  const { eventId } = useParams<{ eventId: string }>()
  const { uid } = useAuth()
  const { event, zones, checkpoints, loading, notFound } = useEventConfig(eventId)

  if (loading || !uid) return <Screen title="Loading…" />
  if (notFound || !event) return <Screen title="Event not found" />

  const zoneName = (id: string) =>
    id === OUTSIDE ? 'Outside' : (zones.find((z) => z.id === id)?.name ?? 'Unknown')

  return (
    <div className="bg-white text-black">
      <div className="no-print sticky top-0 flex items-center justify-between gap-3 border-b border-neutral-300 bg-white p-3">
        <span className="text-sm text-neutral-700">
          {checkpoints.length + 1} cards · print at letter size, portrait
        </span>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-black px-4 py-2 font-bold text-white"
        >
          Print
        </button>
      </div>

      {checkpoints.map((c) => (
        <Card
          key={c.id}
          eventLine={`${event.name} · ${event.date} · ${event.venue}`}
          title={c.name}
          url={volunteerUrl(eventId!, c.token)}
          lines={[
            { label: 'Tap IN for each person going to', value: zoneName(c.toZoneId) },
            { label: 'Tap OUT for each person going to', value: zoneName(c.fromZoneId) },
          ]}
        />
      ))}

      <Card
        eventLine={`${event.name} · ${event.date} · ${event.venue}`}
        title="Organizer dashboard"
        url={dashboardUrl(eventId!)}
        lines={[{ label: 'Live crowd view', value: 'Organizers only' }]}
      />
    </div>
  )
}

function Card({
  eventLine,
  title,
  url,
  lines,
}: {
  eventLine: string
  title: string
  url: string
  lines: { label: string; value: string }[]
}) {
  return (
    <div className="print-page mx-auto flex w-[7.5in] flex-col items-center border-b border-dashed border-neutral-300 px-6 py-10 text-center">
      <div className="mb-2 text-base font-semibold text-neutral-600">{eventLine}</div>
      <h1 className="mb-6 text-5xl leading-tight font-black">{title}</h1>

      <QR value={url} size={380} />

      <div className="mt-5 mb-6 text-xl font-semibold">Scan this code with your phone</div>

      <div className="w-full max-w-[6in] space-y-3">
        {lines.map((l) => (
          <div key={l.label} className="border-t-2 border-black pt-3">
            <div className="text-lg text-neutral-700">{l.label}</div>
            <div className="text-3xl font-black">{l.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-xs break-all text-neutral-500">{url}</div>
    </div>
  )
}
