import type { SiteBucket } from '../series'

export const STAFF_BLOCK_MIN = 15

export type StaffBlock = {
  t: number
  /** Highest on-site count seen in the block. */
  peakOnSite: number
  /** ceil(peak on site / ratio). */
  staff: number
  /** One of the blocks needing the most staff. */
  isPeak: boolean
}

/**
 * The organizer's ratio applied to counted occupancy. `site` should be sampled
 * finely (every minute) so the block peak is not missed between samples.
 */
export function staffingBlocks(
  site: SiteBucket[],
  ratio: number,
  blockMin: number = STAFF_BLOCK_MIN,
): StaffBlock[] {
  if (site.length === 0 || ratio <= 0) return []
  const blockMs = blockMin * 60_000
  const start = Math.floor(site[0].t / blockMs) * blockMs
  const peaks = new Map<number, number>()
  for (const b of site) {
    const key = start + Math.floor((b.t - start) / blockMs) * blockMs
    peaks.set(key, Math.max(peaks.get(key) ?? 0, b.onSite))
  }
  const blocks = [...peaks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, peakOnSite]) => ({ t, peakOnSite, staff: Math.ceil(peakOnSite / ratio), isPeak: false }))
  const most = Math.max(...blocks.map((b) => b.staff))
  for (const b of blocks) b.isPeak = most > 0 && b.staff === most
  return blocks
}
