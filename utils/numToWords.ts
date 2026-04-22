/**
 * Convert a non-negative integer / decimal to English words (USD-style).
 * Supports up to billions, which covers any realistic invoice amount.
 * Fractional parts (cents) render as " Only" when zero, or "and NN/100" when present.
 *
 *   numToEnglishWords(13200)     → "Thirteen Thousand Two Hundred"
 *   numToEnglishWords(13200.50)  → "Thirteen Thousand Two Hundred and 50/100"
 *
 * Deliberately simple: no Indian lakhs/crores, no currency symbol, no i18n —
 * the caller prefixes with "USD" or the spelled-out currency name.
 */

const UNITS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigit(n: number): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]}-${UNITS[u]}`;
}

function threeDigit(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${UNITS[h]} Hundred`);
  if (rest > 0) parts.push(twoDigit(rest));
  return parts.join(" ");
}

export function numToEnglishWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);

  let words: string;
  if (whole === 0) {
    words = "Zero";
  } else {
    const billions = Math.floor(whole / 1_000_000_000);
    const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((whole % 1_000_000) / 1000);
    const rest = whole % 1000;

    const parts: string[] = [];
    if (billions > 0) parts.push(`${threeDigit(billions)} Billion`);
    if (millions > 0) parts.push(`${threeDigit(millions)} Million`);
    if (thousands > 0) parts.push(`${threeDigit(thousands)} Thousand`);
    if (rest > 0) parts.push(threeDigit(rest));
    words = parts.join(" ");
  }

  if (cents > 0) {
    words += ` and ${cents.toString().padStart(2, "0")}/100`;
  }
  return negative ? `Negative ${words}` : words;
}
