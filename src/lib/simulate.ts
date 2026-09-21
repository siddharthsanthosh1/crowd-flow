import {
  Timestamp,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { OUTSIDE } from '../types'
import { clearPlanningDemo, demoFoodZone, seedPlanningDemo } from './planning/simulate'
import type { Checkpoint, FlagType, TapDirection, Zone } from '../types'

/**
 * A generated festival, for showing the dashboard to people when there is no
 * crowd outside.
 *
 * Two things this deliberately does NOT do:
 *
 *   * It does not write taps by a special route or mark them as fake. The rules
 *     pin every tap's deviceId to the writer's uid and allow no other fields, so
 *     a simulated tap is byte-for-byte an ordinary tap. Everything downstream -
 *     occupancy, forecasting, scoring, health, alerts - therefore behaves
 *     exactly as it will on the night, which is the whole point. What marks the
 *     data as generated is the `demo` flag on the event and the SIMULATED badge
 *     the dashboard draws from it.
 *   * It does not fabricate forecast history. A forecast may only be written
 *     with a target in the future and scored only after that target passes, so
 *     scored forecasts cannot be conjured - they have to be earned in real time
 *     by leaving the dashboard open. See RUNNING THE SIMULATION in the README.
 */

/** Festival minutes the simulation covers. */
export const SPAN_MIN = 180
/** Of those, how many are written instantly as backdated history. */
export const HISTORY_MIN = 160
/** Wall-clock time the remaining festival minutes are played out over. */
export const LIVE_MS = 3 * 60_000
/** After the live phase, a light trickle keeps the dashboard alive. */
export const TRICKLE_PER_MIN = 8

const MINUTE = 60_000
/** Firestore allows 500 operations per batch; leave headroom. */
const BATCH_SIZE = 450

export type PlannedTap = {
  /** Festival minute, 0 to SPAN_MIN. */
  m: number
  checkpointId: string
  direction: TapDirection
}

export type PlannedFlag = {
  m: number
  checkpointId: string
  type: FlagType
}

export type SimPlan = {
  taps: PlannedTap[]
  flags: PlannedFlag[]
  /** Festival minutes during which a checkpoint recorded nothing. */
  silences: { checkpointId: string; fromMin: number; toMin: number }[]
  history: PlannedTap[]
  live: PlannedTap[]
}

/** Deterministic PRNG, so two runs of the demo tell the same story. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * The roles the shape needs, worked out from the event's own layout rather than
 * from names: whatever leads outside is the gate, and the inside paths are
 * ranked by how big the area behind them is.
 */
export function assignRoles(zones: Zone[], checkpoints: Checkpoint[]) {
  const capacity = new Map(zones.map((z) => [z.id, z.capacity]))
  const gates = checkpoints.filter(
    (c) => c.fromZoneId === OUTSIDE || c.toZoneId === OUTSIDE,
  )
  const inner = checkpoints
    .filter((c) => c.fromZoneId !== OUTSIDE && c.toZoneId !== OUTSIDE)
    .sort((a, b) => (capacity.get(b.toZoneId) ?? 0) - (capacity.get(a.toZoneId) ?? 0))

  return {
    gate: gates[0] ?? null,
    /** Biggest inner area: fills late and hard, the headline act. */
    headline: inner[0] ?? null,
    /** Second: fills through the middle of the evening and empties again. */
    food: inner[1] ?? null,
    /** The rest: steady browsing all evening. */
    browse: inner.slice(2),
  }
}

/** Smooth bump centred on `at`, `width` minutes wide, peaking at 1. */
function bump(m: number, at: number, width: number): number {
  const x = (m - at) / width
  return Math.exp(-x * x)
}

/**
 * How people move, per festival minute.
 *
 * Arrivals at the gate are an absolute rate - the street does not care how full
 * the park is. Everything inside is a *share of the people who are actually
 * there*, because a path can only carry people who are standing on the other
 * end of it. Modelling the inside as absolute rates drains the main lawn to
 * nothing by the middle of the evening and then invents people out of it during
 * the finale.
 *
 * The shape is a Diwali evening in a park: a thin trickle while it is still
 * light, a hard surge when people finish dinner and arrive together, the food
 * court filling through the middle, and everyone converging on the stage for
 * the programme at the end - which is what actually puts a zone over capacity.
 */
function ratesAt(m: number) {
  return {
    /** People per minute through the gate. */
    arriving: 1.5 + 24 * bump(m, 42, 22) + 9 * bump(m, 98, 42) + 2 * bump(m, 150, 30),
    /** Share of the entrance area that leaves for the night, per minute. */
    leaving: m < 100 ? 0.0004 : 0.0016 + 0.005 * bump(m, 182, 45),

    toHeadline: 0.002 + 0.006 * bump(m, 75, 45) + 0.062 * bump(m, 163, 20),
    fromHeadline: 0.002 + 0.007 * bump(m, 115, 45),

    toFood: 0.002 + 0.014 * bump(m, 80, 40) + 0.004 * bump(m, 140, 25),
    fromFood: 0.003 + 0.008 * bump(m, 125, 45) + 0.05 * bump(m, 166, 20),

    toBrowse: 0.0015 + 0.010 * bump(m, 90, 50),
    fromBrowse: 0.002 + 0.007 * bump(m, 128, 50) + 0.03 * bump(m, 166, 20),
  }
}

/**
 * How big a crowd the button generates unless asked for a different one.
 *
 * 1 is a full-size evening against the demo event's capacities, and it is the
 * default because the alert story is the point: capacities are fixed numbers,
 * so a half-size crowd is half the percentage everywhere and no zone ever gets
 * near its limit. A smaller scale is cheaper in writes and shows everything
 * except the alerts.
 */
export const DEFAULT_SCALE = 1

/**
 * Turn the rates into individual taps.
 *
 * `scale` multiplies arrivals at the gate and nothing else. Everything inside
 * the site is a share of the people standing there, so a smaller crowd moves
 * around in exactly the same proportions - every percentage on the dashboard,
 * and therefore every alert, is identical at any scale. Only the write bill
 * changes, and every tap is a write. See the write-cost note in the README.
 */
export function planFestival(
  zones: Zone[],
  checkpoints: Checkpoint[],
  { scale = DEFAULT_SCALE, seed = 20261017 }: { scale?: number; seed?: number } = {},
): SimPlan {
  const roles = assignRoles(zones, checkpoints)
  const random = rng(seed)
  const taps: PlannedTap[] = []

  // A checkpoint that stops reporting in the middle of the evening, and a
  // second that dies late and never comes back - the one the organizer should
  // still be able to see on the dashboard during the demo.
  const silences: SimPlan['silences'] = []
  if (roles.food) silences.push({ checkpointId: roles.food.id, fromMin: 88, toMin: 94 })
  const lateDead = roles.browse[0] ?? roles.food
  if (lateDead) {
    silences.push({ checkpointId: lateDead.id, fromMin: HISTORY_MIN - 7, toMin: SPAN_MIN })
  }

  const isSilent = (checkpointId: string, m: number) =>
    silences.some((s) => s.checkpointId === checkpointId && m >= s.fromMin && m < s.toMin)

  // People are conserved: nobody leaves an area that is already empty. Without
  // this the stage rush at the end drains more people off the lawn than ever
  // walked onto it, and the dashboard shows a zone holding more people than are
  // on the whole site - which is exactly the kind of number this app exists to
  // be trusted about. The constraint also does the modelling for us: the rush
  // simply runs out of people and plateaus, the way a real one does.
  const occupancy = new Map<string, number>(zones.map((z) => [z.id, 0]))
  const wouldStrand = (cp: Checkpoint, direction: TapDirection) => {
    const leaving = direction === 'in' ? cp.fromZoneId : cp.toZoneId
    return leaving !== OUTSIDE && (occupancy.get(leaving) ?? 0) <= 0
  }
  const apply = (cp: Checkpoint, direction: TapDirection) => {
    const entering = direction === 'in' ? cp.toZoneId : cp.fromZoneId
    const leaving = direction === 'in' ? cp.fromZoneId : cp.toZoneId
    if (entering !== OUTSIDE) occupancy.set(entering, (occupancy.get(entering) ?? 0) + 1)
    if (leaving !== OUTSIDE) occupancy.set(leaving, (occupancy.get(leaving) ?? 0) - 1)
  }

  // Fractional people carry over between minutes, so a rate of 0.4/min produces
  // a tap every two or three minutes instead of none at all.
  const carry = new Map<string, number>()
  const emit = (cp: Checkpoint | null, direction: TapDirection, rate: number, m: number) => {
    if (!cp) return
    const key = `${cp.id}:${direction}`
    const want = (carry.get(key) ?? 0) + rate * (0.85 + random() * 0.3)
    const n = Math.floor(want)
    carry.set(key, want - n)
    for (let i = 0; i < n; i++) {
      if (wouldStrand(cp, direction)) break
      apply(cp, direction)
      // The movement happened either way; a silent checkpoint means nobody
      // wrote it down, which is precisely the drift the dashboard has to own.
      if (isSilent(cp.id, m)) continue
      taps.push({ m: m + random(), checkpointId: cp.id, direction })
    }
  }

  // The gate may be written either way round; onto the site is whichever
  // direction does not lead OUTSIDE.
  const gate = roles.gate
  const gateZone = gate ? (gate.fromZoneId === OUTSIDE ? gate.toZoneId : gate.fromZoneId) : null
  const onward: TapDirection = gate && gate.fromZoneId === OUTSIDE ? 'in' : 'out'
  const homeward: TapDirection = onward === 'in' ? 'out' : 'in'
  const held = (zoneId: string | null | undefined) => (zoneId ? (occupancy.get(zoneId) ?? 0) : 0)
  /** The far side of an inner path - the area it leads into. */
  const far = (cp: Checkpoint | null) =>
    cp ? (cp.fromZoneId === gateZone ? cp.toZoneId : cp.fromZoneId) : null
  /** "in" on an inner path means towards that far side, unless it is drawn backwards. */
  const inward = (cp: Checkpoint | null): TapDirection =>
    cp && cp.fromZoneId === gateZone ? 'in' : 'out'
  const outward = (cp: Checkpoint | null): TapDirection => (inward(cp) === 'in' ? 'out' : 'in')

  for (let m = 0; m < SPAN_MIN; m++) {
    const r = ratesAt(m)
    emit(gate, onward, r.arriving * scale, m)
    emit(gate, homeward, r.leaving * held(gateZone), m)

    emit(roles.headline, inward(roles.headline), r.toHeadline * held(gateZone), m)
    emit(roles.headline, outward(roles.headline), r.fromHeadline * held(far(roles.headline)), m)

    emit(roles.food, inward(roles.food), r.toFood * held(gateZone), m)
    emit(roles.food, outward(roles.food), r.fromFood * held(far(roles.food)), m)

    const share = Math.max(1, roles.browse.length)
    for (const cp of roles.browse) {
      emit(cp, inward(cp), (r.toBrowse / share) * held(gateZone), m)
      emit(cp, outward(cp), r.fromBrowse * held(far(cp)), m)
    }
  }

  taps.sort((a, b) => a.m - b.m)

  const flags: PlannedFlag[] = []
  if (roles.gate) flags.push({ m: 46, checkpointId: roles.gate.id, type: 'long_line' })
  if (roles.headline) flags.push({ m: 150, checkpointId: roles.headline.id, type: 'needs_staff' })

  return {
    taps,
    flags,
    silences,
    history: taps.filter((t) => t.m <= HISTORY_MIN),
    live: taps.filter((t) => t.m > HISTORY_MIN),
  }
}

export type SimProgress = {
  phase: 'history' | 'live' | 'trickle' | 'done'
  written: number
  total: number
  message: string
}

/** Handle for a simulation in flight. Stop ends the trickle; the data stays. */
export type SimHandle = { stop: () => void }

function tapDoc(eventId: string, checkpointId: string, direction: TapDirection, atMs: number, uid: string) {
  return {
    ref: doc(collection(db, 'events', eventId, 'taps')),
    data: {
      checkpointId,
      direction,
      clientTs: Timestamp.fromMillis(atMs),
      serverTs: serverTimestamp(),
      deviceId: uid,
      undone: false,
    },
  }
}

/**
 * Write the plan. History goes in immediately as backdated taps - the rules
 * accept any clientTs within the last 24 hours, which is the same allowance
 * that lets a volunteer's offline taps sync late - and the last stretch is
 * played out live so the dashboard visibly moves while people are watching it.
 */
export async function runSimulation({
  eventId,
  uid,
  zones,
  checkpoints,
  scale = DEFAULT_SCALE,
  onProgress,
}: {
  eventId: string
  uid: string
  zones: Zone[]
  checkpoints: Checkpoint[]
  scale?: number
  onProgress: (p: SimProgress) => void
}): Promise<SimHandle> {
  const plan = planFestival(zones, checkpoints, { scale })
  const started = Date.now()
  const total = plan.taps.length
  let written = 0
  let stopped = false

  // Festival minute m, for m <= HISTORY_MIN, happened (HISTORY_MIN - m) minutes ago.
  const historyMs = (m: number) => started - (HISTORY_MIN - m) * MINUTE

  onProgress({ phase: 'history', written: 0, total, message: 'Writing the first 2h40m…' })

  for (let i = 0; i < plan.history.length; i += BATCH_SIZE) {
    const chunk = plan.history.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    for (const t of chunk) {
      const { ref, data } = tapDoc(eventId, t.checkpointId, t.direction, historyMs(t.m), uid)
      batch.set(ref, data)
    }
    await batch.commit()
    written += chunk.length
    onProgress({
      phase: 'history',
      written,
      total,
      message: `Writing the first 2h40m… ${written} of ${total}`,
    })
  }

  // Flags land in the recent past so they are already waiting on the dashboard.
  const flagBatch = writeBatch(db)
  for (const f of plan.flags) {
    flagBatch.set(doc(collection(db, 'events', eventId, 'flags')), {
      checkpointId: f.checkpointId,
      type: f.type,
      clientTs: Timestamp.fromMillis(historyMs(Math.min(f.m, HISTORY_MIN))),
      serverTs: serverTimestamp(),
      acknowledged: false,
    })
  }
  await flagBatch.commit()

  // Trucks, service times and an order share for the Planning section. They
  // live in their own collections and are invisible while planning is off.
  // A failure here must never stop the demo itself.
  await seedPlanningDemo({
    eventId,
    uid,
    foodZoneId: demoFoodZone(zones, checkpoints, assignRoles(zones, checkpoints).food),
    minuteToMs: historyMs,
  }).catch((e) => console.warn('planning demo data not written', e))

  // ---- the live tail, played out over LIVE_MS ----------------------------
  const live = plan.live
  const liveSpan = SPAN_MIN - HISTORY_MIN
  const delayFor = (m: number) => ((m - HISTORY_MIN) / liveSpan) * LIVE_MS
  const liveStart = Date.now()

  // Taps due within the same short window go up together. The dashboard still
  // updates several times a second, but a busy minute of the finale is a few
  // round trips instead of a few hundred.
  const FLUSH_MS = 400

  const run = async () => {
    for (let i = 0; i < live.length; ) {
      if (stopped) return
      const windowEnd = liveStart + Math.ceil((delayFor(live[i].m) + 1) / FLUSH_MS) * FLUSH_MS
      const chunk: PlannedTap[] = []
      while (i < live.length && liveStart + delayFor(live[i].m) < windowEnd) chunk.push(live[i++])

      const wait = windowEnd - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      if (stopped) return

      const batch = writeBatch(db)
      for (const t of chunk) {
        const { ref, data } = tapDoc(eventId, t.checkpointId, t.direction, Date.now(), uid)
        batch.set(ref, data)
      }
      batch.commit().catch((e) => console.error('sim taps rejected', e))
      written += chunk.length
      onProgress({
        phase: 'live',
        written,
        total,
        message: `Playing the last 20 minutes live… ${Math.min(
          100,
          Math.round(((Date.now() - liveStart) / LIVE_MS) * 100),
        )}%`,
      })
    }

    // Keep a little movement going. Without it the zones freeze, and a forecast
    // scored against a frozen zone is a straight line predicting a straight
    // line - it would make the accuracy tile look far better than it is.
    const roles = assignRoles(zones, checkpoints)
    const wander = [roles.gate, roles.headline, roles.food, ...roles.browse].filter(
      (c): c is Checkpoint => c !== null,
    )
    const random = rng(7)
    onProgress({
      phase: 'trickle',
      written,
      total,
      message: 'Trickle running - leave the dashboard open so forecasts can be scored. Stop when you are done.',
    })
    while (!stopped) {
      await new Promise((r) => setTimeout(r, (60_000 / TRICKLE_PER_MIN) * (0.5 + random())))
      if (stopped) break
      const cp = wander[Math.floor(random() * wander.length)]
      const direction: TapDirection = random() < 0.58 ? 'in' : 'out'
      const { ref, data } = tapDoc(eventId, cp.id, direction, Date.now(), uid)
      const batch = writeBatch(db)
      batch.set(ref, data)
      batch.commit().catch((e) => console.error('sim tap rejected', e))
      written++
    }
    onProgress({ phase: 'done', written, total, message: `Stopped. ${written} taps written.` })
  }

  void run()
  return { stop: () => { stopped = true } }
}

/**
 * Soft-delete everything this browser wrote to the event.
 *
 * Simulated taps carry no marker of their own - the rules do not allow one - so
 * what identifies them is that they were written by this device. That is also
 * the only thing the rules let this device undo, so the two line up exactly.
 * On a demo event nothing else has written from here, so this is the whole
 * simulation and nothing but it.
 */
export async function clearSimulation({
  eventId,
  uid,
  onProgress,
}: {
  eventId: string
  uid: string
  onProgress: (message: string) => void
}): Promise<number> {
  await clearPlanningDemo(eventId, uid).catch((e) => console.warn('service times not cleared', e))
  onProgress('Finding simulated taps…')
  const snap = await getDocs(
    query(collection(db, 'events', eventId, 'taps'), where('deviceId', '==', uid)),
  )
  const live = snap.docs.filter((d) => d.data().undone !== true)
  if (live.length === 0) {
    onProgress('Nothing to clear.')
    return 0
  }

  let done = 0
  for (let i = 0; i < live.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const d of live.slice(i, i + BATCH_SIZE)) batch.update(d.ref, { undone: true })
    await batch.commit()
    done += Math.min(BATCH_SIZE, live.length - i)
    onProgress(`Clearing… ${done} of ${live.length}`)
    // Every one of these updates fans out to the listeners on any open
    // dashboard. Yielding between batches keeps this page - and them - usable.
    await new Promise((r) => setTimeout(r, 0))
  }
  onProgress(`Cleared ${done} simulated taps.`)
  return done
}

/** How many non-undone taps the event already holds, from any device. */
export async function countLiveTaps(eventId: string): Promise<number> {
  const snap = await getDocs(collection(db, 'events', eventId, 'taps'))
  return snap.docs.filter((d) => d.data().undone !== true).length
}
