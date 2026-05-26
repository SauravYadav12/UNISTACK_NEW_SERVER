/**
 * Employee probation utilities.
 *
 * Rule
 * ────
 * Every new joiner starts a 3-month probation from their joining date.
 * During probation:
 *   - No paid leaves are accrued or available.
 *   - Any leave request must be filed as UL (unpaid leave).
 *
 * After probation:
 *   - Paid leave eligibility begins on the FIRST of the month immediately
 *     following the 3-month probation window.
 *   - Allocation for the remainder of the calendar year is prorated at
 *     each type's monthly-quota rate × months remaining.
 *   - Monthly accrual re-anchors so the leave-eligible start month is
 *     month 1 of the ceiling formula.
 *
 * Example — April 1 joiner:
 *   - Apr/May/Jun = probation (no paid leaves).
 *   - Jul 1 = leave-start. Allocated 6 PL + 6 ML for Jul–Dec.
 *   - Jul = 1 available (1 month accrued), Aug = 2, …, Dec = 6.
 *
 * Example — October 1 joiner:
 *   - Oct/Nov/Dec = probation.
 *   - Jan 1 of NEXT year = leave-start (handled by the annual reset).
 *   - Current year allocation = 0.
 *
 * All dates are interpreted in the company's working calendar (IST/UTC
 * mix is acceptable — month boundaries are coarse enough that a few-
 * hour skew is irrelevant for the rule). Callers should pass real
 * `Date` objects; this module does no string parsing of its own.
 */

export const PROBATION_MONTHS = 3;

/**
 * Calendar-day length of the standard probation window. Used by the
 * activation hook to compute `probationOriginalEndDate = DOJ + 90d`
 * — the daily cron compares this to "today" to decide when to nudge
 * the admins to confirm.
 */
export const PROBATION_DAYS = 90;

/**
 * Compute the original (un-extended) probation end date from a joining
 * date. This is `DOJ + PROBATION_DAYS`, used as the trigger threshold
 * for the daily admin notification. Admin extensions shift the *stored*
 * field forward; this helper only returns the canonical starting value.
 */
export function computeProbationOriginalEndDate(dateOfJoining: Date): Date {
  const d = new Date(dateOfJoining);
  d.setDate(d.getDate() + PROBATION_DAYS);
  return d;
}

/**
 * Probation applies only to employees whose `dateOfJoining` is on or
 * after this cutoff. Earlier joiners keep the pre-feature behaviour
 * (full prorata, no zero-leave window). Bump only if the policy ever
 * needs to apply retroactively. Reset day is the day this feature
 * landed.
 */
export const PROBATION_FEATURE_LAUNCH_DATE = new Date(Date.UTC(2026, 4, 23, 0, 0, 0));

/**
 * Returns `true` if the employee's joining date is in the post-launch
 * cohort and probation rules should apply to their allocations.
 */
export function isProbationApplicable(
  dateOfJoining: Date | null | undefined,
): boolean {
  if (!dateOfJoining) return false;
  return dateOfJoining.getTime() >= PROBATION_FEATURE_LAUNCH_DATE.getTime();
}

/**
 * Returns `true` if the user is currently inside their 3-month
 * probation window. A user with no joining date is treated as
 * *not* on probation — falling back to legacy behaviour for the
 * pre-feature install base.
 */
export function isOnProbation(
  dateOfJoining: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!dateOfJoining) return false;
  const end = probationEndDate(dateOfJoining);
  return now.getTime() < end.getTime();
}

/**
 * Returns the exact end-of-probation timestamp — midnight on the first
 * day of the leave-eligible month. After this instant the employee
 * begins accruing paid leaves under the prorata rule.
 */
export function probationEndDate(dateOfJoining: Date): Date {
  const start = new Date(dateOfJoining);
  // First day of (joinMonth + PROBATION_MONTHS). JS Date handles
  // year rollover automatically, so December + 3 → next year's March.
  return new Date(start.getFullYear(), start.getMonth() + PROBATION_MONTHS, 1, 0, 0, 0, 0);
}

/**
 * `{ year, month }` of the first leave-eligible month. `month` is
 * 1-indexed to match Mongo / human convention.
 *
 *   April 1 joiner → { year: <same>, month: 7 }
 *   October 1 joiner → { year: <next>, month: 1 }
 */
export function getLeaveStartMonth(
  dateOfJoining: Date,
): { year: number; month: number } {
  const end = probationEndDate(dateOfJoining);
  return { year: end.getFullYear(), month: end.getMonth() + 1 };
}

/**
 * Number of months in `targetYear` that the employee is leave-eligible.
 * For an April joiner asked about the same year → 6 (Jul–Dec).
 * For an October joiner asked about the same year → 0 (probation runs
 * out the clock). For any joiner asked about a future year → 12.
 *
 * Used by the leave allocator to prorate the year's allocation.
 */
export function eligibleMonthsInYear(
  dateOfJoining: Date | null | undefined,
  targetYear: number,
): number {
  if (!dateOfJoining) return 12;
  const { year: startYear, month: startMonth } = getLeaveStartMonth(dateOfJoining);
  if (startYear > targetYear) return 0;
  if (startYear < targetYear) return 12;
  // Same year — count Jul (7) … Dec (12) = 6.
  return Math.max(0, 12 - startMonth + 1);
}

/**
 * 1-indexed month within `targetYear` that monthly accrual begins.
 *
 *   April joiner, same year → 7 (July).
 *   April joiner, next year → 1 (January, standard reset).
 *   October joiner, same year → 13 (sentinel meaning "no eligibility
 *     this year"; callers should treat allocation as 0).
 */
export function leaveStartMonthForYear(
  dateOfJoining: Date | null | undefined,
  targetYear: number,
): number {
  if (!dateOfJoining) return 1;
  const { year: startYear, month: startMonth } = getLeaveStartMonth(dateOfJoining);
  if (startYear < targetYear) return 1;
  if (startYear > targetYear) return 13; // sentinel
  return startMonth;
}
