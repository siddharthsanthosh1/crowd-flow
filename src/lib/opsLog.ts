import type { Flag, FlagType, Forecast, Reset, Zone } from '../types'
import type { ZoneSeries } from './series'

export type OpsSeverity = 'info' | 'warn' | 'critical'

export type OpsEntry = {
  id: string
  at: number
  kind: 'alert' | 'flag' | 'reset' | 'forecast'
  title: string
  detail: string
  severity: OpsSeverity
}

const FLAG_LABELS: Record<FlagType, string> = {
  long_line: 'Long line',
  hazard: 'Spill or hazard',
  needs_staff: 'Needs staff',
  medical: 'Medical',
}

export const BUSY_PCT = 85

/**
 * Alerts are derived from the occupancy series rather than stored when they
 * happen. That keeps the tap log the only source of truth - the same alert
 * history comes back after a reload, and it can be replayed for any past
 * moment - and it costs no writes.
 */
export function alertsFromSeries(
  zones: Zone[],
  series: Map<string, ZoneSeries>,
): OpsEntry[] {
  const out: OpsEntry[] = []

  for (const zone of zones) {
    const points = series.get(zone.id)?.points ?? []
    if (zone.capacity <= 0) continue
    let wasBusy = false
    let wasFull = false

    for (const point of points) {
      const pct = (point.v / zone.capacity) * 100
      const isBusy = pct > BUSY_PCT
      const isFull = point.v >= zone.capacity

      if (isBusy && !wasBusy) {
        out.push({
          id: `busy-${zone.id}-${point.t}`,
          at: point.t,
          kind: 'alert',
          title: `${zone.name} passed ${BUSY_PCT}%`,
          detail: `${point.v.toLocaleString()} of ${zone.capacity.toLocaleString()}`,
          severity: 'warn',
        })
      }
      if (!isBusy && wasBusy) {
        out.push({
          id: `calm-${zone.id}-${point.t}`,
          at: point.t,
          kind: 'alert',
          title: `${zone.name} back under ${BUSY_PCT}%`,
          detail: `${point.v.toLocaleString()} of ${zone.capacity.toLocaleString()}`,
          severity: 'info',
        })
      }
      if (isFull && !wasFull) {
        out.push({
          id: `full-${zone.id}-${point.t}`,
          at: point.t,
          kind: 'alert',
          title: `${zone.name} reached capacity`,
          detail: `${point.v.toLocaleString()} of ${zone.capacity.toLocaleString()}`,
          severity: 'critical',
        })
      }
      wasBusy = isBusy
      wasFull = isFull
    }
  }

  return out
}

/** Alerts, flags, resets and scored forecasts on one timeline, newest first. */
export function buildOpsLog({
  zones,
  series,
  flags,
  resets,
  forecasts,
  checkpointName,
}: {
  zones: Zone[]
  series: Map<string, ZoneSeries>
  flags: Flag[]
  resets: Reset[]
  forecasts: Forecast[]
  checkpointName: (id: string) => string
}): OpsEntry[] {
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? 'Unknown zone'

  const entries: OpsEntry[] = [...alertsFromSeries(zones, series)]

  for (const flag of flags) {
    entries.push({
      id: `flag-${flag.id}`,
      at: flag.clientTs.toMillis(),
      kind: 'flag',
      title: FLAG_LABELS[flag.type],
      detail: `${checkpointName(flag.checkpointId)}${flag.acknowledged ? ' · acknowledged' : ''}`,
      severity: flag.type === 'medical' ? 'critical' : 'warn',
    })
  }

  for (const reset of resets) {
    entries.push({
      id: `reset-${reset.id}`,
      at: reset.ts ? reset.ts.toMillis() : Date.now(),
      kind: 'reset',
      title: `${zoneName(reset.zoneId)} reset to ${reset.newCount.toLocaleString()}`,
      detail: reset.note ?? 'Count corrected by the organizer',
      severity: 'info',
    })
  }

  for (const forecast of forecasts) {
    if (forecast.actualOccupancy === null) continue
    const error = forecast.predictedOccupancy - forecast.actualOccupancy
    const over = error > 0
    entries.push({
      id: `forecast-${forecast.id}`,
      at: forecast.targetTime.toMillis(),
      kind: 'forecast',
      title: `${zoneName(forecast.zoneId)} forecast was ${
        error === 0 ? 'exact' : `${Math.abs(error)} ${over ? 'high' : 'low'}`
      }`,
      detail: `predicted ${forecast.predictedOccupancy.toLocaleString()}, actual ${forecast.actualOccupancy.toLocaleString()}`,
      severity: 'info',
    })
  }

  return entries.sort((a, b) => b.at - a.at)
}
