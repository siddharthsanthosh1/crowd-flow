import { BAND_STYLES, band, percent } from '../lib/format'
import type { Zone } from '../types'

const DOT_MIN = 26
const DOT_MAX = 72

/**
 * The site map with each positioned zone drawn as a circle sized by how many
 * people are in it and coloured by how full it is. The number is always printed
 * inside, so the circle is never the only way to read the value.
 */
export function SiteMap({
  imageUrl,
  zones,
  occupancy,
  onPlace,
  placingZoneId,
}: {
  imageUrl: string
  zones: Zone[]
  occupancy: Map<string, number>
  /** Supplied by the admin page to reposition a zone by tapping the map. */
  onPlace?: (x: number, y: number) => void
  placingZoneId?: string | null
}) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPlace) return
    const rect = e.currentTarget.getBoundingClientRect()
    onPlace(
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    )
  }

  const placed = zones.filter((z) => z.mapX !== undefined && z.mapY !== undefined)

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-neutral-800 ${
        onPlace ? 'cursor-crosshair' : ''
      }`}
      onClick={handleClick}
    >
      <img src={imageUrl} alt="Site map" className="block w-full" />

      {placed.map((zone) => {
        const count = occupancy.get(zone.id) ?? 0
        const pct = percent(count, zone.capacity)
        const styles = BAND_STYLES[band(pct)]
        const size = DOT_MIN + (DOT_MAX - DOT_MIN) * Math.min(1, pct / 100)
        const isPlacing = placingZoneId === zone.id
        return (
          <div
            key={zone.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(zone.mapX ?? 0) * 100}%`, top: `${(zone.mapY ?? 0) * 100}%` }}
          >
            <div
              className={`flex items-center justify-center rounded-full border-2 bg-neutral-950/85 ${styles.bg} ${
                isPlacing ? 'ring-2 ring-white' : ''
              }`}
              style={{ width: size, height: size }}
            >
              <span className={`text-xs font-bold tabular-nums ${styles.text}`}>{count}</span>
            </div>
            <span className="mt-0.5 block text-center text-[10px] whitespace-nowrap text-neutral-300">
              {zone.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
