export function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}