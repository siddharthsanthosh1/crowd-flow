const KEY = 'crowdflow:events'

export type RememberedEvent = { id: string; name: string }

/**
 * Events this browser has created. Firestore never lists events - ids are
 * unguessable and unlistable on purpose - so the admin's own device keeps the
 * list. Losing it only means you need the event URL again.
 */
export function rememberedEvents(): RememberedEvent[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as RememberedEvent[]) : []
  } catch {
    return []
  }
}

export function rememberEvent(event: RememberedEvent) {
  const all = rememberedEvents().filter((e) => e.id !== event.id)
  all.unshift(event)
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20)))
}

export function forgetEvent(id: string) {
  localStorage.setItem(KEY, JSON.stringify(rememberedEvents().filter((e) => e.id !== id)))
}
