const UNITS: { threshold: number; suffix: string }[] = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
]

/**
 * Formats a count compactly with ~3 significant figures, using K/M/B suffixes for
 * thousands/millions/billions (e.g. 1234567 -> "1.23M", 45678 -> "45.7K", 234 -> "234").
 * Numbers under 1,000 are returned as-is (already 3 digits or fewer).
 */
export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n)
  const unit = UNITS.find((u) => abs >= u.threshold)
  if (!unit) return n.toLocaleString()

  const value = n / unit.threshold
  const digitsBeforeDecimal = Math.max(1, Math.floor(Math.log10(Math.abs(value))) + 1)
  const decimals = Math.max(3 - digitsBeforeDecimal, 0)
  return `${value.toFixed(decimals)}${unit.suffix}`
}
