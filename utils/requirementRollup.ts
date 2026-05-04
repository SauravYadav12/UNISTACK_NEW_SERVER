import { INTERVIEWED_OR_BEYOND, SUBMITTED_OR_BEYOND } from "./scoring";

/**
 * Rollup helpers for the parent/child Requirement split.
 *
 * On a parent row with children, the parent's own `reqStatus` is stale
 * ("New Working" forever). The authoritative status for reporting lives on
 * its children. `bestChildStatus` returns the furthest-along status any
 * child has reached — so a Support report / dashboard rollup can credit the
 * parent for the progress that actually happened.
 *
 * Ranking (highest wins):
 *   Project Active > Interviewed > Submitted > Submission in progress > New Working
 *
 * "Project Inactive" and "Cancelled" are deliberately NOT treated as
 * "better" than Interviewed — they're closure states, not progress states,
 * so a parent with one Cancelled child and one Submitted child reports as
 * Submitted. "Project Inactive" lands at the bottom of the positive ladder
 * (higher than Cancelled, lower than New Working) so a parent that had one
 * project spin down isn't counted as "active".
 *
 * "Submission in progress" sits between New Working and Submitted — a
 * transitional state where the consultant is being prepared for a formal
 * submission. It outranks New Working in the rollup so a parent with one
 * child still being prepared and another untouched reports as the more
 * advanced state.
 */

export type RequirementStatusLike =
  | "New Working"
  | "Submission in progress"
  | "Submitted"
  | "Interviewed"
  | "Project Active"
  | "Project Inactive"
  | "Cancelled";

// Higher index wins. Anything not in this list ranks as -1 and is ignored.
const STATUS_RANK: RequirementStatusLike[] = [
  "Cancelled",
  "Project Inactive",
  "New Working",
  "Submission in progress",
  "Submitted",
  "Interviewed",
  "Project Active",
];

export function bestChildStatus(
  children: { reqStatus?: string }[],
): RequirementStatusLike | undefined {
  let bestIdx = -1;
  for (const c of children) {
    const idx = STATUS_RANK.indexOf(c.reqStatus as RequirementStatusLike);
    if (idx > bestIdx) bestIdx = idx;
  }
  return bestIdx >= 0 ? STATUS_RANK[bestIdx] : undefined;
}

/**
 * Sanity helpers that mirror the scorer's semantics. Used when rolling up
 * "did ANY child reach …" in the Support report.
 */
export function anyChildReachedSubmitted(children: { reqStatus?: string }[]): boolean {
  return children.some((c) => SUBMITTED_OR_BEYOND.has(c.reqStatus || ""));
}

export function anyChildReachedInterviewed(children: { reqStatus?: string }[]): boolean {
  return children.some((c) => INTERVIEWED_OR_BEYOND.has(c.reqStatus || ""));
}
