import {
  Timestamp,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Forecast, Zone } from '../types'

/** How often a forecast is recorded for each zone. */
export const FORECAST_INTERVAL_MS = 2 * 60_000
/** How far ahead each forecast looks. */
export const FORECAST_HORIZON_MIN = 15
/**
 * How long to wait past targetTime before scoring a forecast. Taps made offline
 * arrive late, and scoring a prediction against a tap log that is still filling
 * in would blame the forecast for someone's bad signal.
 */
export const RESOLVE_GRACE_MS = 2 * 60_000

/**
 * Deterministic id: the zone plus the interval the forecast was made in. Two
 * organizer dashboards open at once write the same document instead of two.
 */
export function forecastDocId(zoneId: string, madeAtMs: number): string {
  return `${zoneId}__${Math.floor(madeAtMs / FORECAST_INTERVAL_MS)}`
}

export function recordForecast(
  eventId: string,
  zoneId: string,
  madeAtMs: number,
  predictedOccupancy: number,
): Promise<void> {
  const targetMs = madeAtMs + FORECAST_HORIZON_MIN * 60_000
  return setDoc(doc(db, 'events', eventId, 'forecasts', forecastDocId(zoneId, madeAtMs)), {
    zoneId,
    madeAt: serverTimestamp(),
    targetTime: Timestamp.fromMillis(targetMs),
    predictedOccupancy: Math.round(predictedOccupancy),
    horizonMin: FORECAST_HORIZON_MIN,
    actualOccupancy: null,
    resolvedAt: null,
  })
}

export function resolveForecast(
  eventId: string,
  forecastId: string,
  actualOccupancy: number,
): Promise<void> {
  return updateDoc(doc(db, 'events', eventId, 'forecasts', forecastId), {
    actualOccupancy: Math.round(actualOccupancy),
    resolvedAt: serverTimestamp(),
  })
}

/** Forecasts whose target time has passed and settled, but which have no score yet. */
export function dueForResolution(forecasts: Forecast[], now: number): Forecast[] {
  return forecasts.filter(
    (f) =>
      f.actualOccupancy === null &&
      now >= f.targetTime.toMillis() + RESOLVE_GRACE_MS,
  )
}

export type Accuracy = {
  count: number
  /** Mean absolute error, in people. Null when nothing has been scored yet. */
  mae: number | null
  /** Mean signed error: positive means the forecast runs high. */
  bias: number | null
}

export function accuracyOf(forecasts: Forecast[]): Accuracy {
  const scored = forecasts.filter((f) => f.actualOccupancy !== null)
  if (scored.length === 0) return { count: 0, mae: null, bias: null }
  let absolute = 0
  let signed = 0
  for (const f of scored) {
    const error = f.predictedOccupancy - (f.actualOccupancy as number)
    absolute += Math.abs(error)
    signed += error
  }
  return {
    count: scored.length,
    mae: absolute / scored.length,
    bias: signed / scored.length,
  }
}

export function accuracyByZone(
  zones: Zone[],
  forecasts: Forecast[],
): Map<string, Accuracy> {
  const out = new Map<string, Accuracy>()
  for (const zone of zones) {
    out.set(zone.id, accuracyOf(forecasts.filter((f) => f.zoneId === zone.id)))
  }
  return out
}
