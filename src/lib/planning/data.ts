import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Timestamp,
  collection,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { newId } from '../ids'
import { FORECAST_HORIZON_MIN, forecastDocId } from '../forecastLog'
import type { Forecast } from '../../types'
import type { PlanningConfig, PlanningEvent, ServiceTime, Truck } from './types'

/**
 * Is the planning layer showing? `?planning=1` in the URL turns it on for this
 * page load and `?planning=0` turns it off, whatever the event says; otherwise
 * it follows the "Planning features" switch on the admin page. Off by default.
 */
export function usePlanningFlag(event: PlanningEvent | null): boolean {
  const { search } = useLocation()
  const override = new URLSearchParams(search).get('planning')
  if (override === '1') return true
  if (override === '0') return false
  return event?.planning?.enabled === true
}

/** Organizer inputs. Pass null to clear one. */
export async function savePlanning(
  eventId: string,
  patch: { [K in keyof PlanningConfig]?: PlanningConfig[K] | null },
): Promise<void> {
  const update: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    update[`planning.${key}`] = value === null ? deleteField() : value
  }
  await updateDoc(doc(db, 'events', eventId), update)
}

/** The /service/... link token, created the first time it is needed. */
export async function ensureServiceToken(event: PlanningEvent): Promise<string> {
  const existing = event.planning?.serviceToken
  if (existing) return existing
  const token = newId()
  await savePlanning(event.id, { serviceToken: token })
  return token
}

export const serviceUrl = (eventId: string, token: string) =>
  `${location.origin}/service/${eventId}/${token}`

// ---- trucks -------------------------------------------------------------

export function useTrucks(eventId: string | undefined, uid: string | null, enabled = true) {
  const [trucks, setTrucks] = useState<Truck[]>([])
  useEffect(() => {
    if (!eventId || !uid || !enabled) return
    const q = query(collection(db, 'events', eventId, 'trucks'), orderBy('order'))
    return onSnapshot(q, (snap) =>
      setTrucks(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Truck).filter((t) => !t.archived),
      ),
    )
  }, [eventId, uid, enabled])
  return { trucks }
}

export async function saveTruck(eventId: string, truck: Truck): Promise<void> {
  const { id, ...rest } = truck
  await setDoc(doc(db, 'events', eventId, 'trucks', id), rest, { merge: true })
}

export async function archiveTruck(eventId: string, truckId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventId, 'trucks', truckId), { archived: true })
}

// ---- service times ------------------------------------------------------

/** Every service time for the event. A few hundred at most. */
export function useServiceTimes(eventId: string | undefined, uid: string | null, enabled = true) {
  const [samples, setSamples] = useState<ServiceTime[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    if (!eventId || !uid || !enabled) return
    return onSnapshot(
      collection(db, 'events', eventId, 'serviceTimes'),
      { includeMetadataChanges: true },
      (snap) => {
        let pending = 0
        const rows = snap.docs.map((d) => {
          if (d.metadata.hasPendingWrites) pending++
          return { id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites } as ServiceTime
        })
        rows.sort((a, b) => a.clientTs.toMillis() - b.clientTs.toMillis())
        setSamples(rows)
        setPendingCount(pending)
      },
    )
  }, [eventId, uid, enabled])
  return { samples, pendingCount }
}

/**
 * One customer's service time. Not awaited, for the same reason as a tap:
 * offline, the promise only settles once signal comes back, but the write is
 * already safe in IndexedDB and on screen.
 */
export function recordServiceTime(
  eventId: string,
  truckId: string,
  durationMs: number,
  deviceId: string,
): string {
  const ref = doc(collection(db, 'events', eventId, 'serviceTimes'))
  setDoc(ref, {
    truckId,
    durationMs: Math.round(durationMs),
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    deviceId,
    undone: false,
  }).catch((e) => console.error('service time rejected', e))
  return ref.id
}

export function undoServiceTime(eventId: string, id: string): void {
  updateDoc(doc(db, 'events', eventId, 'serviceTimes', id), { undone: true }).catch((e) =>
    console.error('undo rejected', e),
  )
}

// ---- Holt forecasts -----------------------------------------------------

export function useHoltForecasts(eventId: string | undefined, uid: string | null, enabled: boolean) {
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!eventId || !uid || !enabled) return
    setLoaded(false)
    const q = query(
      collection(db, 'events', eventId, 'forecastsHolt'),
      orderBy('targetTime', 'desc'),
      limit(500),
    )
    return onSnapshot(q, (snap) => {
      setForecasts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Forecast))
      setLoaded(true)
    })
  }, [eventId, uid, enabled])
  return useMemo(() => ({ forecasts, loaded }), [forecasts, loaded])
}

export function recordHoltForecast(
  eventId: string,
  zoneId: string,
  madeAtMs: number,
  predictedOccupancy: number,
): Promise<void> {
  return setDoc(doc(db, 'events', eventId, 'forecastsHolt', forecastDocId(zoneId, madeAtMs)), {
    zoneId,
    madeAt: serverTimestamp(),
    targetTime: Timestamp.fromMillis(madeAtMs + FORECAST_HORIZON_MIN * 60_000),
    predictedOccupancy: Math.round(predictedOccupancy),
    horizonMin: FORECAST_HORIZON_MIN,
    actualOccupancy: null,
    resolvedAt: null,
  })
}

export function resolveHoltForecast(eventId: string, id: string, actual: number): Promise<void> {
  return updateDoc(doc(db, 'events', eventId, 'forecastsHolt', id), {
    actualOccupancy: Math.round(actual),
    resolvedAt: serverTimestamp(),
  })
}
