/**
 * Normalize a value to [0, 1] within a domain, with optional log scale and invert.
 */
export function normalizeValue(
  value: number | null,
  domain: { min: number; max: number },
  opts?: { log?: boolean; invert?: boolean },
): number | null {
  if (value == null) return null;
  let val = value;
  let min = domain.min;
  let max = domain.max;
  if (opts?.log) {
    const offset = min > 0 ? 0 : 1 - min;
    val = Math.log10(val + offset);
    min = Math.log10(min + offset);
    max = Math.log10(max + offset);
  }
  let t = (max - min) === 0 ? 0.5 : (val - min) / (max - min);
  if (opts?.invert) t = 1 - t;
  return t;
}
