/** Unguessable id for events and checkpoint tokens. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// No 0/O/1/I/L - the admin types this on a second device, possibly in the dark.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** A human-typeable admin secret, e.g. "K7M2-9QXP-4RTV". */
export function newAdminSecret(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((g) => g.join(''))
    .join('-')
}

export function normalizeSecret(input: string): string {
  return input.trim().toUpperCase()
}
