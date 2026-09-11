import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { alertsFromSeries, buildOpsLog } from './opsLog'
import type { ZoneSeries } from './series'
import type { Flag, Forecast, Reset, Zone } from '../types'

const zone: Zone = { id: 'lawn', name: 'Main Lawn', capacity: 100, order: 0 }
const T0 = Date.parse('2026-10-17T17:00:00Z')
const min = (n: number) => T0 + n * 60_000

const seriesOf = (values: number[]): Map<string, ZoneSeries> =>
  new Map([
    [
      'lawn',
      {
        points: values.map((v, i) => ({ t: min(i), v })),
        peak: { value: Math.max(...values), at: T0 },
      },
    ],
  ])

describe('alertsFromSeries', () => {
  it('fires once when a zone crosses 85%, not on every point above it', () => {
    const alerts = alertsFromSeries([zone], seriesOf([10, 50, 86, 90, 95]))
    expect(alerts.filter((a) => a.title.includes('passed 85%'))).toHaveLength(1)
    expect(alerts[0].at).toBe(min(2))
  })

  it('reports recovery and re-fires if it climbs again', () => {
    const alerts = alertsFromSeries([zone], seriesOf([90, 50, 90]))
    expect(alerts.map((a) => a.title)).toEqual([
      'Main Lawn passed 85%',
      'Main Lawn back under 85%',
      'Main Lawn passed 85%',
    ])
  })

  it('marks reaching capacity as critical', () => {
    const alerts = alertsFromSeries([zone], seriesOf([50, 100]))
    const full = alerts.find((a) => a.title.includes('reached capacity'))
    expect(full?.severity).toBe('critical')
  })

  it('says nothing when a zone stays comfortable', () => {
    expect(alertsFromSeries([zone], seriesOf([10, 20, 30]))).toEqual([])
  })

  it('ignores a zone with no capacity set', () => {
    const noCapacity: Zone = { ...zone, capacity: 0 }
    expect(alertsFromSeries([noCapacity], seriesOf([10, 500]))).toEqual([])
  })
})

describe('buildOpsLog', () => {
  const flag: Flag = {
    id: 'f1',
    checkpointId: 'gate',
    type: 'medical',
    clientTs: Timestamp.fromMillis(min(1)),
    serverTs: null,
    acknowledged: false,
  }
  const reset: Reset = {
    id: 'r1',
    zoneId: 'lawn',
    newCount: 0,
    ts: Timestamp.fromMillis(min(3)),
  }
  const forecast: Forecast = {
    id: 'fc1',
    zoneId: 'lawn',
    madeAt: Timestamp.fromMillis(min(0)),
    targetTime: Timestamp.fromMillis(min(5)),
    predictedOccupancy: 120,
    horizonMin: 15,
    actualOccupancy: 100,
    resolvedAt: Timestamp.fromMillis(min(5)),
  }

  const build = () =>
    buildOpsLog({
      zones: [zone],
      series: seriesOf([10, 20, 30]),
      flags: [flag],
      resets: [reset],
      forecasts: [forecast, { ...forecast, id: 'fc2', actualOccupancy: null }],
      checkpointName: () => 'Gate A',
    })

  it('puts everything on one timeline, newest first', () => {
    const log = build()
    expect(log.map((e) => e.kind)).toEqual(['forecast', 'reset', 'flag'])
  })

  it('scores a forecast that ran high', () => {
    expect(build()[0].title).toBe('Main Lawn forecast was 20 high')
  })

  it('leaves unscored forecasts out of the log', () => {
    expect(build().filter((e) => e.kind === 'forecast')).toHaveLength(1)
  })

  it('treats a medical flag as critical', () => {
    expect(build().find((e) => e.kind === 'flag')?.severity).toBe('critical')
  })
})
