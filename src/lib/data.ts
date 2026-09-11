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
import type { Checkpoint, EventDoc, Flag, Reset, Tap, Zone } from '../types'

/**
 * Event document, zones, checkpoints and resets. Everything the app needs to
 * interpret the tap log. All four are small and change rarely.
 */
export function useEventConfig(eventId: string | undefined) {
  const [event, setEvent] = useState<EventDoc | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [resets, setResets] = useState<Reset[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId) return
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
  }, [eventId])

  return { event, zones, checkpoints, resets, loading, notFound, error }
}

/**
 * Every tap for the event, oldest first. The dashboard derives all of its
 * numbers from this. Ordered by clientTs, which - unlike serverTs - is already
 * set on taps that are still queued offline.
 */
export function useAllTaps(eventId: string | undefined) {
  const [taps, setTaps] = useState<Tap[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventId) return
    const q = query(collection(db, 'events', eventId, 'taps'), orderBy('clientTs'))
    return onSnapshot(q, (snap) => {
      setTaps(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tap))
      setLoading(false)
    })
  }, [eventId])

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
export function useFlags(eventId: string | undefined) {
  const [flags, setFlags] = useState<Flag[]>([])

  useEffect(() => {
    if (!eventId) return
    const q = query(
      collection(db, 'events', eventId, 'flags'),
      orderBy('clientTs', 'desc'),
      limit(200),
    )
    return onSnapshot(q, (snap) =>
      setFlags(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Flag)),
    )
  }, [eventId])

  return { flags }
}
