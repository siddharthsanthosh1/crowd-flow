import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import type {
  Checkpoint,
  EventDoc,
  Flag,
  Forecast,
  Reset,
  SuggestedAction,
  Tap,
  Zone,
} from '../types'

/**
 * Event document, zones, checkpoints and resets. Everything the app needs to
 * interpret the tap log. All four are small and change rarely.
 *
 * Takes `uid` and does nothing until it has one. A listener attached before
 * anonymous sign-in completes is rejected by the rules, and Firestore does not
 * retry a permission error - the listener is dead for the life of the page. On
 * a phone that has never opened the app, that meant a volunteer scanning their
 * card and getting "Loading..." forever.
 */
export function useEventConfig(eventId: string | undefined, uid: string | null) {
  const [event, setEvent] = useState<EventDoc | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [resets, setResets] = useState<Reset[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId || !uid) return
    setLoading(true)
    setNotFound(false)

    const fail = (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load event')

    const unsubEvent = onSnapshot(
      doc(db, 'events', eventId),
      (snap) => {
        setEvent(snap.exists() ? ({ id: snap.id, ...snap.data() } as EventDoc) : null)
        setNotFound(!snap.exists())
        setLoading(false)
      },
      fail,
    )
    const unsubZones = onSnapshot(
      query(collection(db, 'events', eventId, 'zones'), orderBy('order')),
      (snap) =>
        setZones(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Zone)
            .filter((z) => !z.archived),
        ),
      fail,
    )
    const unsubCheckpoints = onSnapshot(
      query(collection(db, 'events', eventId, 'checkpoints'), orderBy('order')),
      (snap) =>
        setCheckpoints(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Checkpoint)
            .filter((c) => !c.archived),
        ),
      fail,
    )
    const unsubResets = onSnapshot(
      collection(db, 'events', eventId, 'resets'),
      (snap) => setResets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Reset)),
      fail,
    )

    return () => {
      unsubEvent()
      unsubZones()
      unsubCheckpoints()
      unsubResets()
    }
  }, [eventId, uid])

  return { event, zones, checkpoints, resets, loading, notFound, error }
}

/**
 * Every tap for the event, oldest first. The dashboard derives all of its
 * numbers from this. Ordered by clientTs, which - unlike serverTs - is already
 * set on taps that are still queued offline.
 */
export function useAllTaps(eventId: string | undefined, uid: string | null) {
  const [taps, setTaps] = useState<Tap[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventId || !uid) return
    const q = query(collection(db, 'events', eventId, 'taps'), orderBy('clientTs'))
    return onSnapshot(q, (snap) => {
      setTaps(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tap))
      setLoading(false)
    })
  }, [eventId, uid])

  return { taps, loading }
}

/**
 * Just this device's recent taps. The volunteer screen uses this for the
 * 60-second tally, for UNDO, and to count writes that have not yet synced.
 * Deliberately not the whole event: a volunteer's phone should not download
 * thousands of other people's taps over a bad connection.
 */
export function useMyRecentTaps(eventId: string | undefined, deviceId: string | null) {
  const [taps, setTaps] = useState<Tap[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!eventId || !deviceId) return
    const q = query(
      collection(db, 'events', eventId, 'taps'),
      where('deviceId', '==', deviceId),
      orderBy('clientTs', 'desc'),
      limit(100),
    )
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const rows: Tap[] = []
      let pending = 0
      snap.forEach((d) => {
        if (d.metadata.hasPendingWrites) pending++
        rows.push({
          id: d.id,
          ...d.data(),
          pending: d.metadata.hasPendingWrites,
        } as Tap)
      })
      setTaps(rows)
      setPendingCount(pending)
    })
  }, [eventId, deviceId])

  return { taps, pendingCount }
}

/** All flags for the event, newest first. */
export function useFlags(eventId: string | undefined, uid: string | null) {
  const [flags, setFlags] = useState<Flag[]>([])

  useEffect(() => {
    if (!eventId || !uid) return
    const q = query(
      collection(db, 'events', eventId, 'flags'),
      orderBy('clientTs', 'desc'),
      limit(200),
    )
    return onSnapshot(q, (snap) =>
      setFlags(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Flag)),
    )
  }, [eventId, uid])

  return { flags }
}

/** Recorded forecasts, so the dashboard can score itself against what happened. */
export function useForecasts(eventId: string | undefined, uid: string | null) {
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  // Until the first snapshot lands we do not know what has already been
  // recorded, and a dashboard that starts writing before then will collide with
  // whatever another dashboard already wrote for this interval.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!eventId || !uid) return
    setLoaded(false)
    const q = query(
      collection(db, 'events', eventId, 'forecasts'),
      orderBy('targetTime', 'desc'),
      limit(500),
    )
    return onSnapshot(q, (snap) => {
      setForecasts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Forecast))
      setLoaded(true)
    })
  }, [eventId, uid])

  return { forecasts, loaded }
}

/** "When {zone} is over {n}%, show: {text}" - set up on the admin page. */
export function useActions(eventId: string | undefined, uid: string | null) {
  const [actions, setActions] = useState<SuggestedAction[]>([])

  useEffect(() => {
    if (!eventId || !uid) return
    const q = query(collection(db, 'events', eventId, 'actions'), orderBy('order'))
    return onSnapshot(q, (snap) =>
      setActions(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as SuggestedAction)
          .filter((a) => !a.archived),
      ),
    )
  }, [eventId, uid])

  return { actions }
}

/**
 * The site map image, stored as a data URL in its own document so volunteer
 * phones - which read the event document - never download it.
 */
export function useSiteMap(eventId: string | undefined, uid: string | null) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId || !uid) return
    return onSnapshot(doc(db, 'events', eventId, 'map', 'image'), (snap) =>
      setDataUrl(snap.exists() ? ((snap.data().dataUrl as string) ?? null) : null),
    )
  }, [eventId, uid])

  return { siteMap: dataUrl }
}
