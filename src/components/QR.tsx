import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Rendered at high resolution and scaled down by CSS, so the printed card is
 * crisp on paper rather than at screen DPI.
 */
export function QR({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, {
      width: 1200,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [value])

  if (!src) return <div style={{ width: size, height: size }} />
  return <img src={src} alt="" style={{ width: size, height: size }} />
}
