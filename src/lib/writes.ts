import {
  Timestamp,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { FlagType, Tap, TapDirection } from '../types'

/** Undo is only offered for this long after the tap. */
export const UNDO_WINDOW_MS = 60_000

/**
 * Record one tap.
 *
 * Deliberately NOT awaited by callers. Offline, the returned promise does not
 * settle until the connection comes back - but Firestore has already written
 * the tap to IndexedDB and pushed it into every local listener, so the UI is
 * correct immediately. Awaiting here would freeze the button for 20 minutes.
 */
export function recordTap(
  eventId: string,
  checkpointId: string,
  direction: TapDirection,
  deviceId: string,
): void {
  const ref = doc(collection(db, 'events', eventId, 'taps'))
  setDoc(ref, {
    checkpointId,
    direction,
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    deviceId,
    undone: false,
  }).catch((e) => console.error('tap rejected', e))
}

/**
 * The most recent tap from this device at this checkpoint that is still inside
 * the undo window and not already undone.
 */
export function undoableTap(taps: Tap[], checkpointId: string, now: number): Tap | null {
  for (const tap of taps) {
    if (tap.checkpointId !== checkpointId) continue
    if (tap.undone) continue
    if (now - tap.clientTs.toMillis() > UNDO_WINDOW_MS) continue
    return tap
  }
  return null
}

/** Soft-delete. Taps are never removed from the log. */
export function undoTap(eventId: string, tapId: string): void {
  updateDoc(doc(db, 'events', eventId, 'taps', tapId), { undone: true }).catch((e) =>
    console.error('undo rejected', e),
  )
}

export function raiseFlag(eventId: string, checkpointId: string, type: FlagType): void {
  const ref = doc(collection(db, 'events', eventId, 'flags'))
  setDoc(ref, {
    checkpointId,
    type,
    clientTs: Timestamp.now(),
    serverTs: serverTimestamp(),
    acknowledged: false,
  }).catch((e) => console.error('flag rejected', e))
}
