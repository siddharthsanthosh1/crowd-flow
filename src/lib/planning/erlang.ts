/**
 * Erlang C: the M/M/c queue.
 *
 * Customers arrive at random at rate λ, any of c identical servers can take the
 * next one, and each service takes an exponentially distributed time with mean
 * 1/μ. Rates here are per minute and waits are in minutes, but any consistent
 * unit works.
 */

/**
 * Probability an arriving customer has to wait at all, for c servers offered
 * a = λ/μ erlangs of work. Only meaningful while a < c; at or above that the
 * queue grows without limit and this returns 1.
 *
 * Computed through the Erlang B recursion rather than factorials, which stays
 * accurate for any number of servers.
 */
export function erlangC(c: number, a: number): number {
  if (c < 1 || !Number.isInteger(c)) throw new Error(`servers must be a positive integer, got ${c}`)
  if (a <= 0) return 0
  if (a >= c) return 1
  let b = 1
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b)
  const rho = a / c
  return b / (1 - rho * (1 - b))
}

export type QueueResult =
  | { growing: false; rho: number; pWait: number; wq: number }
  | { growing: true; rho: number }

/**
 * Utilisation ρ = λ/(cμ) and, while ρ < 1, the expected wait in line
 * Wq = C(c, a) / (cμ − λ). At ρ ≥ 1 there is no steady state - the line just
 * keeps getting longer - so no wait is reported.
 */
export function mmc(lambda: number, mu: number, c: number): QueueResult {
  if (mu <= 0) throw new Error('service rate must be positive')
  const rho = lambda / (c * mu)
  if (rho >= 1) return { growing: true, rho }
  if (lambda <= 0) return { growing: false, rho: 0, pWait: 0, wq: 0 }
  const pWait = erlangC(c, lambda / mu)
  return { growing: false, rho, pWait, wq: pWait / (c * mu - lambda) }
}
