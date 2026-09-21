import type { Timestamp } from 'firebase/firestore'
import type { EventDoc } from '../../types'

/**
 * Organizer inputs for the planning report, stored as one map on the event
 * document. Kept out of src/types.ts on purpose: that file is part of the
 * volunteer screen, which this work must not touch.
 *
 * Only `enabled`, `targetWaitMin` and `missProb` have defaults. The order share
 * and the staffing ratio are the organizer's judgement and the app never
 * invents them.
 */
export type PlanningConfig = {
  /** The "Planning features" switch. Off, or missing, means off. */
  enabled?: boolean
  /** Share of food-court visitors who order, 0-1. No default. */
  orderShare?: number
  /** Longest acceptable wait at the food trucks, minutes. Default 10. */
  targetWaitMin?: number
  /** Chance any one person walks past a volunteer uncounted, 0-1. Default 0.03. */
  missProb?: number
  /** Target on-site people per staff member. No default. */
  staffRatio?: number
  /** Which zone is the food court. */
  foodZoneId?: string
  /** Secret part of the /service/... link, like a checkpoint token. */
  serviceToken?: string
}

export type PlanningEvent = EventDoc & { planning?: PlanningConfig }

export const DEFAULT_TARGET_WAIT_MIN = 10
export const DEFAULT_MISS_PROB = 0.03

export type Truck = {
  id: string
  name: string
  order: number
  archived?: boolean
}

/** One customer, from reaching the window to walking away with food. */
export type ServiceTime = {
  id: string
  truckId: string
  durationMs: number
  clientTs: Timestamp
  serverTs: Timestamp | null
  deviceId: string
  undone: boolean
  pending?: boolean
}

/** Same shape as a linear forecast, kept in its own collection. */
export type { Forecast as HoltForecast } from '../../types'
