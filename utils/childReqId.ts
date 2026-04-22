import { RequirementModel } from "../models/requirementModel";

/**
 * Child requirement IDs are parent-prefixed with a letter suffix:
 *   REQ-05-A, REQ-05-B, … REQ-05-Z, REQ-05-AA, REQ-05-AB, …
 *
 * The suffix is Excel-column style (base-26 with A=1). That way nothing ever
 * wraps around to collide with an earlier suffix and the grid can sort
 * lexicographically on `childSuffix` and get a natural A < B < … < AA < AB.
 */

/** Convert 1 → "A", 26 → "Z", 27 → "AA". n must be >= 1. */
export function indexToSuffix(n: number): string {
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`indexToSuffix expects n >= 1, got ${n}`);
  }
  let result = "";
  let num = Math.floor(n);
  while (num > 0) {
    const rem = (num - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

/** Convert "A" → 1, "Z" → 26, "AA" → 27, etc. Returns 0 on empty/invalid. */
export function suffixToIndex(suffix: string | undefined | null): number {
  if (!suffix) return 0;
  let n = 0;
  for (const ch of suffix.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return 0;
    n = n * 26 + (code - 64);
  }
  return n;
}

/**
 * Look up the highest existing suffix under a parent and return the next one.
 * Assignments are never recycled — even if a child is deleted its suffix
 * stays retired. That keeps interview → reqID references stable.
 */
export async function nextChildSuffix(parentReqID: string): Promise<string> {
  const children = await RequirementModel.find({ parentReqID })
    .select("childSuffix")
    .lean();
  let maxIdx = 0;
  for (const c of children) {
    const idx = suffixToIndex(c.childSuffix);
    if (idx > maxIdx) maxIdx = idx;
  }
  return indexToSuffix(maxIdx + 1);
}

export function buildChildReqID(parentReqID: string, suffix: string): string {
  return `${parentReqID}-${suffix}`;
}
