/**
 * format.ts: small display formatters shared across the UI.
 *
 * Odds-specific formatting lives in `utils/odds.ts` and `utils/gameGroups.ts`,
 * which carry their own rounding rules. This module only holds the generic
 * conversions that would otherwise be re-typed at every call site.
 */

/**
 * formatPercent renders a 0..1 ratio as a fixed-precision percentage figure.
 *
 * The returned string carries no percent sign: call sites place the literal
 * `%` themselves, which keeps it a separate text node where the markup
 * already treats it as one.
 */
export function formatPercent(value: number, digits: number): string {
  return (value * 100).toFixed(digits);
}
