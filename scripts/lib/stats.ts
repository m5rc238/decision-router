// Small stats helpers for the eval reports (Task 4).

/** 95% Wilson score interval for a proportion; returns [lo, hi] or null when n=0. */
export function wilson95(k: number, n: number, z = 1.959963984540054): [number, number] | null {
  if (!Number.isFinite(n) || n <= 0) return null
  if (k < 0 || k > n) return null
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/** Format a [lo, hi] proportion as a compact +− percentage string. */
export function fmtWilson(k: number, n: number): string {
  const ci = wilson95(k, n)
  if (!ci) return 'n/a'
  const p = k / n
  return `${(100 * p).toFixed(1)}% ±${(100 * (ci[1] - p)).toFixed(1)}`
}