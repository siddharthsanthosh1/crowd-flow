import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { auth } from '../firebase'

/**
 * Anonymous sign-in. There are no accounts; the uid is a stable per-install id
 * that we also use as the device id, so a device can only undo its own taps.
 *
 * The session is cached by Firebase Auth, so a phone that has opened the app
 * once will sign in again with no connection. The very first load of the app on
 * a given phone does need signal.
 */
export function useAuth() {
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid)
        return
      }
      signInAnonymously(auth).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not sign in')
      })
    })
  }, [])

  return { uid, error }
}
