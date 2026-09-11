/**
 * Shrink a picked image into a data URL small enough to live in a Firestore
 * document.
 *
 * Firestore documents cap at 1 MiB and base64 inflates by about a third, so the
 * target is generous but firm. Storing the map this way means the project needs
 * no Cloud Storage bucket, no second set of rules, and nothing to clean up later
 * - which matters for a Town that has to keep this running without a developer.
 */
export async function imageToDataUrl(
  file: File,
  maxDimension = 1400,
  maxBytes = 400_000,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // Step the quality down until it fits. Site maps are flat graphics, so they
  // usually fit on the first try.
  for (const quality of [0.8, 0.65, 0.5, 0.4, 0.3]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= maxBytes) return dataUrl
  }
  throw new Error('That image is too detailed to store. Try a simpler or smaller map.')
}
