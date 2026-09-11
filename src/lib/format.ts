/** "4s" / "3m 20s" / "1h 05m" - compact enough for a dashboard row. */
export function durationLabel(ms: number): string {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

export function percent(occupancy: number, capacity: number): number {
  if (capacity <= 0) return 0
  return Math.round((occupancy / capacity) * 100)
}

/** Green under 60%, yellow to 85%, red above. */
export type Band = 'green' | 'yellow' | 'red'

export function band(pct: number): Band {
  if (pct > 85) return 'red'
  if (pct >= 60) return 'yellow'
  return 'green'
}

export const BAND_STYLES: Record<Band, { bg: string; text: string; dot: string }> = {
  green: { bg: 'bg-emerald-950 border-emerald-600', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  yellow: { bg: 'bg-amber-950 border-amber-500', text: 'text-amber-300', dot: 'bg-amber-400' },
  red: { bg: 'bg-red-950 border-red-500', text: 'text-red-300', dot: 'bg-red-400' },
}
