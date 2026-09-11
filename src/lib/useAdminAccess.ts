import { useCallback, useEffect, useState } from 'react'
import { claimAdmin } from './admin'
import { normalizeSecret } from './ids'

const secretKey = (eventId: string) => `crowdflow:secret:${eventId}`
const confirmedKey = (eventId: string) => `crowdflow:admin:${eventId}`

export type AdminStatus = 'checking' | 'yes' | 'no'

/**
 * Is this device allowed to make organizer-level changes to this event?
 *
 * The secret is kept in localStorage so the organizer types it once per device.
 * If we have confirmed it before we trust that immediately, so the dashboard's
 * organizer actions still work when the tablet drops off the network.
 */
export function useAdminAccess(eventId: string | undefined, uid: string | null) {
  const [status, setStatus] = useState<AdminStatus>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId || !uid) return
    const secret = localStorage.getItem(secretKey(eventId))
    if (!secret) {
      setStatus('no')
      return
    }
    if (localStorage.getItem(confirmedKey(eventId)) === '1') setStatus('yes')

    claimAdmin(eventId, secret, uid)
      .then(() => {
        localStorage.setItem(confirmedKey(eventId), '1')
        setStatus('yes')
      })
      .catch(() => {
        // Wrong secret, or simply offline. Only downgrade if we never confirmed.
        if (localStorage.getItem(confirmedKey(eventId)) !== '1') setStatus('no')
      })
  }, [eventId, uid])

  const unlock = useCallback(
    async (raw: string) => {
      if (!eventId || !uid) return
      const secret = normalizeSecret(raw)
      setError(null)
      try {
        await claimAdmin(eventId, secret, uid)
        localStorage.setItem(secretKey(eventId), secret)
        localStorage.setItem(confirmedKey(eventId), '1')
        setStatus('yes')
      } catch {
        setError('That secret was not accepted.')
      }
    },
    [eventId, uid],
  )

  return { status, error, unlock }
}

export function rememberSecret(eventId: string, secret: string) {
  localStorage.setItem(secretKey(eventId), secret)
  localStorage.setItem(confirmedKey(eventId), '1')
}
