import type { Checkpoint, Reset, Zone } from '../types'

/**
 * How much to trust a zone's number.
 *
 * Occupancy is a running difference of two large counts, so every missed or
 * double tap stays in the number for the rest of the night. Nothing in the data
 * can tell us how wrong we are - if we could measure the error we would correct
 * it. What we can measure is how long it has been since the number was last
 * known to be right, which is the event start or the zone's last reset. That is
 * a proxy for accumulated drift, and it is labelled as one everywhere it shows.
 */
export type Confidence = 'high' | 'medium' | 'low'

/** Minutes since calibration at which confidence steps down. */
export const CONFIDENCE_MEDIUM_AFTER_MIN = 30
export const CONFIDENCE_LOW_AFTER_MIN = 90

/** A checkpoint quiet for longer than this is corrupting the zones it feeds. */
export const SILENT_FEEDER_MS = 5 * 60_000

export function confidenceFromMinutes(minutes: number): Confidence {
  if (minutes < CONFIDENCE_MEDIUM_AFTER_MIN) return 'high'
  if (minutes < CONFIDENCE_LOW_AFTER_MIN) return 'medium'
  return 'low'
}

/**
 * The moment this zone's count was last known to be right: its most recent
 * reset, or - if it has never been reset - the start of the event.
 */
export function calibratedAt(zoneId: string, eventStart: number, resets: Reset[]): number {
  let at = eventStart
  for (const r of resets) {
    if (r.zoneId !== zoneId) continue
    const ms = r.ts ? r.ts.toMillis() : Date.now()
    if (ms > at) at = ms
  }
  return at
}

export type ZoneConfidence = {
  level: Confidence
  /** Minutes since the last reset, or since the event started. */
  minutesSince: number
  /** True when a reset - not the event start - is what set the clock. */
  fromReset: boolean
}

export function zoneConfidence(
  zoneId: string,
  eventStart: number,
  resets: Reset[],
  now: number,
): ZoneConfidence {
  const at = calibratedAt(zoneId, eventStart, resets)
  const minutesSince = Math.max(0, (now - at) / 60_000)
  return {
    level: confidenceFromMinutes(minutesSince),
    minutesSince,
    fromReset: at > eventStart,
  }
}

/** Every checkpoint whose taps change this zone's count, in either direction. */
export function feedersOf(zoneId: string, checkpoints: Checkpoint[]): Checkpoint[] {
  return checkpoints.filter((c) => c.fromZoneId === zoneId || c.toZoneId === zoneId)
}

export type SilentFeeder = {
  checkpoint: Checkpoint
  /** Last tap here, or the event start if it has never reported at all. */
  since: number
  everReported: boolean
}

/**
 * Checkpoints feeding this zone that have gone quiet. A dead phone shows up on
 * the zone whose number it is corrupting, not only in the health list further
 * down the page.
 *
 * A checkpoint that has never reported counts from the event start, so a post
 * nobody ever staffed is caught too - but not in the first few minutes, before
 * anyone would reasonably have tapped.
 */
export function silentFeeders(
  zoneId: string,
  checkpoints: Checkpoint[],
  lastTap: Map<string, number>,
  eventStart: number,
  now: number,
  silentMs: number = SILENT_FEEDER_MS,
): SilentFeeder[] {
  const out: SilentFeeder[] = []
  for (const checkpoint of feedersOf(zoneId, checkpoints)) {
    const last = lastTap.get(checkpoint.id)
    const since = last ?? eventStart
    if (now - since < silentMs) continue
    out.push({ checkpoint, since, everReported: last !== undefined })
  }
  return out
}

/** People per minute, from a net change measured over a window of minutes. */
export function perMinute(netPerWindow: number, windowMinutes: number): number {
  if (windowMinutes <= 0) return 0
  return netPerWindow / windowMinutes
}

/** "+4.2 / min", "-0.7 / min", "0 / min" - one decimal, because 0 hides a trend. */
export function perMinuteLabel(rate: number): string {
  const rounded = Math.round(rate * 10) / 10
  if (rounded === 0) return '0 / min'
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} / min`
}

/** The zone closest to being a problem: soonest to fill, ties broken by fullness. */
export function watchZone<T extends { zone: Zone; pct: number; minutesToCapacity: number | null }>(
  stats: T[],
): T | null {
  const rising = stats.filter((s) => s.minutesToCapacity !== null)
  if (rising.length === 0) return null
  return rising.reduce((best, s) =>
    (s.minutesToCapacity as number) < (best.minutesToCapacity as number) ? s : best,
  )
}
