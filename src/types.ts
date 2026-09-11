import type { Timestamp } from 'firebase/firestore'

/** A zone id of OUTSIDE means "off the event site" - it is never a real zone. */
export const OUTSIDE = 'OUTSIDE'

export type EventDoc = {
  id: string
  name: string
  date: string
  venue: string
  createdAt?: Timestamp
  siteMapUrl?: string
}

export type Zone = {
  id: string
  name: string
  capacity: number
  order: number
  mapX?: number
  mapY?: number
  /** Soft-removed by the admin. Never hard-deleted; hidden everywhere. */
  archived?: boolean
}

export type Checkpoint = {
  id: string
  name: string
  fromZoneId: string
  toZoneId: string
  token: string
  order: number
  /** Soft-removed by the admin. Never hard-deleted; hidden everywhere. */
  archived?: boolean
}

export type TapDirection = 'in' | 'out'

export type Tap = {
  id: string
  checkpointId: string
  direction: TapDirection
  clientTs: Timestamp
  serverTs: Timestamp | null
  deviceId: string
  undone: boolean
  /** True while the write is still queued locally and has not reached the server. */
  pending?: boolean
}

export type FlagType = 'long_line' | 'hazard' | 'needs_staff' | 'medical'

export type Flag = {
  id: string
  checkpointId: string
  type: FlagType
  clientTs: Timestamp
  serverTs: Timestamp | null
  acknowledged: boolean
}

export type Forecast = {
  id: string
  zoneId: string
  madeAt: Timestamp | null
  targetTime: Timestamp
  predictedOccupancy: number
  horizonMin: number
  /** Filled in once targetTime has passed and the taps have settled. */
  actualOccupancy: number | null
  resolvedAt: Timestamp | null
}

export type SuggestedAction = {
  id: string
  zoneId: string
  thresholdPct: number
  text: string
  order: number
  archived?: boolean
}

export type Reset = {
  id: string
  zoneId: string
  newCount: number
  ts: Timestamp | null
  note?: string
}
