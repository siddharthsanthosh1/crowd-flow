import { useEffect } from 'react'

/**
 * Keep the screen on while counting. Unsupported or denied is not an error -
 * the volunteer just has to wake the phone themselves.
 *
 * The lock is dropped by the browser whenever the page is hidden, so we
 * re-acquire it every time the volunteer comes back to the tab.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    if (!('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let released = false

    const acquire = () => {
      navigator.wakeLock
        .request('screen')
        .then((s) => {
          if (released) {
            void s.release()
            return
          }
          sentinel = s
        })
        .catch(() => {
          /* denied, low battery, or not allowed in this context */
        })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sentinel?.release().catch(() => {})
    }
  }, [enabled])
}
