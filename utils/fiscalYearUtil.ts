/**
 * Indian financial year helpers.
 *
 * The financial year runs Apr 1 → Mar 31. We canonicalise an FY by the
 * START year — i.e. "FY 2024–25" is stored as `fiscalYearStart = 2024`.
 * This avoids ambiguity around two-digit shorthand ("FY24-25" vs
 * "FY2425" vs "FY24") that creeps in from different upstream payroll
 * exports.
 */

/**
 * Format an FY start year as the canonical label.
 *
 *   getFYLabel(2024) → "2024-25"
 */
export function getFYLabel(start: number): string {
  if (!Number.isFinite(start)) return "";
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}

/**
 * Which FY does the given date fall in? Apr 1 is the boundary.
 *
 *   getCurrentFYStart(new Date('2025-03-15')) → 2024  (still FY 2024–25)
 *   getCurrentFYStart(new Date('2025-04-01')) → 2025  (now FY 2025–26)
 */
export function getCurrentFYStart(now: Date = new Date()): number {
  const month = now.getMonth(); // 0 = Jan
  const year = now.getFullYear();
  // April = month index 3. Anything Apr–Dec → year; Jan–Mar → year-1.
  return month >= 3 ? year : year - 1;
}

/**
 * Parse a flexible FY input — number, 4-digit string, or any of the
 * shorthands we've seen in real Form-16 filenames — to a canonical
 * start year.
 *
 *   parseFYStart(2024)        → 2024
 *   parseFYStart("2024")      → 2024
 *   parseFYStart("2024-25")   → 2024
 *   parseFYStart("FY2024-25") → 2024
 *   parseFYStart("FY202425")  → 2024
 *   parseFYStart("FY24-25")   → 2024
 *   parseFYStart("FY2425")    → 2024
 *
 * Returns NaN on unparseable input — caller decides whether to fall
 * back to a default (e.g. `getCurrentFYStart()`).
 */
export function parseFYStart(input: string | number): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.trunc(input) : NaN;
  }
  if (typeof input !== "string") return NaN;
  const s = input.trim().toUpperCase().replace(/\s+/g, "");

  // Order matters: try the most specific shapes first so a generic
  // pattern doesn't swallow a more precise one.
  // 1) "FY2024-25" or "2024-25" — 4-digit start + 2-digit end with a separator.
  const m1 = s.match(/^(?:FY)?(\d{4})[-/](\d{2})$/);
  if (m1) return parseInt(m1[1], 10);
  // 2) "FY202425" — 4-digit start glued to 2-digit end.
  const m2 = s.match(/^(?:FY)?(\d{4})(\d{2})$/);
  if (m2) return parseInt(m2[1], 10);
  // 3) "FY24-25" or "24-25" — 2-digit start + 2-digit end with a separator.
  const m3 = s.match(/^(?:FY)?(\d{2})[-/](\d{2})$/);
  if (m3) return 2000 + parseInt(m3[1], 10);
  // 4) "FY2425" — 2+2 glued. Same convention.
  const m4 = s.match(/^(?:FY)?(\d{2})(\d{2})$/);
  if (m4) return 2000 + parseInt(m4[1], 10);
  // 5) Bare "2024" or "FY2024".
  const m5 = s.match(/^(?:FY)?(\d{4})$/);
  if (m5) return parseInt(m5[1], 10);

  return NaN;
}
