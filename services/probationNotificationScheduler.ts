/**
 * Daily probation-review notification scheduler.
 *
 * Each day at 09:00 IST, walks every active employee whose:
 *   - `probationStatus = 'in_progress'`, AND
 *   - `probationOriginalEndDate <= today`
 *
 * …and emits a single notification to every admin/super-admin asking
 * them to confirm or extend the probation. Deduplication is per
 * (recipient, employee, current-originalEndDate): one notification per
 * (employee × end-date) per recipient. When an admin EXTENDS, the
 * `probationOriginalEndDate` moves forward — that changes the dedupe
 * key, so the next day's tick will fire a fresh nudge once the new
 * date is reached. Confirmation moves `probationStatus` to `'confirmed'`,
 * which excludes the employee from the query — no more nudges.
 *
 * Mirrors the structure of `performanceWarningScheduler` so behaviour
 * is predictable (same tick hour, same self-scheduling loop, same
 * notification emit helper).
 */

import moment from "moment-timezone";
import { FilterQuery } from "mongoose";
import { UserProfileModel } from "../models/userProfileModel";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { emitNotification } from "./notificationService";
import {
  PROBATION_FEATURE_LAUNCH_DATE,
  PROBATION_DAYS,
  computeProbationOriginalEndDate,
} from "../utils/probation";

const TZ = "Asia/Kolkata";
const TICK_HOUR = 9;

let scheduledTimer: NodeJS.Timeout | null = null;
let initialised = false;

function msUntilNextTick(): number {
  const now = moment.tz(TZ);
  let next = now.clone().hour(TICK_HOUR).minute(0).second(0).millisecond(0);
  if (next.isSameOrBefore(now)) next = next.add(1, "day");
  return next.valueOf() - Date.now();
}

function scheduleNext() {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  const ms = msUntilNextTick();
  scheduledTimer = setTimeout(async () => {
    try {
      await runTick();
    } catch (e) {
      console.error("[probation-cron] tick failed:", e);
    } finally {
      scheduleNext();
    }
  }, ms);
  const fireAt = moment.tz(TZ).add(ms, "milliseconds").format("LLLL z");
  console.log(`[probation-cron] Next tick scheduled for ${fireAt}`);
}

/**
 * Format a Date as `YYYY-MM-DD` (IST). Used inside dedupe keys so the
 * key changes when an admin extends (originalEndDate shifts day) but
 * stays stable across multiple ticks on the same end-date.
 */
function isoDay(d: Date): string {
  return moment.tz(d, TZ).format("YYYY-MM-DD");
}

async function runTick(): Promise<void> {
  const today = new Date();

  // 1. Find all employees whose probation window has elapsed and are
  //    still in_progress. Two sub-cases:
  //       (a) Explicit status='in_progress' with originalEndDate <= today
  //       (b) Legacy profiles (no status set yet) whose DOJ is post-
  //           feature-launch AND DOJ + 90d <= today
  //    The cutoff for (b) uses a derived threshold instead of a stored
  //    field, so we filter by DOJ <= today - 90d.
  const legacyDojCutoff = new Date(
    today.getTime() - PROBATION_DAYS * 24 * 60 * 60 * 1000,
  );
  const profileFilter = {
    $or: [
      {
        probationStatus: "in_progress",
        probationOriginalEndDate: { $lte: today },
      },
      {
        probationStatus: { $exists: false },
        dateOfJoining: {
          $gte: PROBATION_FEATURE_LAUNCH_DATE,
          $lte: legacyDojCutoff,
        },
      },
    ],
  } as FilterQuery<Record<string, unknown>>;
  const dueProfiles = await UserProfileModel.find(profileFilter)
    .select("user probationOriginalEndDate dateOfJoining")
    .lean();
  if (!dueProfiles.length) {
    console.log("[probation-cron] No probations awaiting confirmation.");
    return;
  }

  // 2. Hydrate the employees (and skip those who've since been deactivated
  //    — no need to notify about someone who left the company).
  const employeeIds = dueProfiles.map((p) => p.user);
  const employeeFilter = {
    _id: { $in: employeeIds },
    active: true,
  } as FilterQuery<Record<string, unknown>>;
  const employees = await UserModel.find(employeeFilter)
    .select("firstName lastName email")
    .lean();
  const empMap = new Map<string, (typeof employees)[number]>();
  for (const e of employees) empMap.set(String(e._id), e);

  // 3. Resolve the recipient set: every admin + super-admin in the
  //    system. Same as the leave-approval routing pattern. Lean query.
  const recipientFilter = {
    role: {
      $in: [UserRole.Admin as unknown as string, UserRole.SuperAdmin as unknown as string],
    },
    active: true,
  } as FilterQuery<Record<string, unknown>>;
  const recipients = await UserModel.find(recipientFilter)
    .select("_id")
    .lean();
  if (!recipients.length) {
    console.warn(
      "[probation-cron] No admin/super-admin recipients configured.",
    );
    return;
  }
  const recipientIds = recipients.map((r) => r._id);

  // 4. Emit. One notification per (employee × originalEndDate),
  //    fanned out to all recipients.
  let emitted = 0;
  for (const p of dueProfiles) {
    const emp = empMap.get(String(p.user));
    if (!emp) continue; // skipped deactivated
    const empName = `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() ||
      emp.email ||
      "Employee";
    // For legacy profiles compute DOJ+90d on the fly. The dedupe key
    // bakes this in so explicit-vs-derived end-dates produce stable
    // (and distinct) keys across runs.
    const effectiveOriginal =
      (p.probationOriginalEndDate
        ? new Date(p.probationOriginalEndDate)
        : null) ??
      (p.dateOfJoining
        ? computeProbationOriginalEndDate(new Date(p.dateOfJoining))
        : null);
    const endDay = effectiveOriginal ? isoDay(effectiveOriginal) : "unknown";
    void emitNotification({
      recipients: recipientIds,
      type: "probation.review-due",
      title: `Confirm probation: ${empName}`,
      body: `${empName}'s 3-month probation window completed on ${endDay}. Open Employee Management to confirm or extend.`,
      link: {
        kind: "employee-management",
        employeeRef: String(p.user),
      },
      // Stable per (employee × end-date). Extending the probation
      // changes endDate → new dedupe key → new nudge. Confirming
      // removes the employee from the query → no further nudges.
      dedupeKey: `probation-review:${p.user}:${endDay}`,
    });
    emitted++;
  }

  console.log(
    `[probation-cron] Emitted ${emitted} notifications to ${recipientIds.length} recipients.`,
  );
}

/**
 * Idempotent bootstrap — safe to call from `app.ts` regardless of how
 * many times the module is re-imported (e.g. in tests).
 */
export function startProbationNotificationScheduler(): void {
  if (initialised) return;
  initialised = true;
  console.log("[probation-cron] starting");
  // Fire once on boot if a tick is overdue (e.g., the server was down
  // when the 09:00 IST slot passed). This is a no-op if there are no
  // pending probations.
  void runTick().catch((e) =>
    console.error("[probation-cron] initial tick failed:", e),
  );
  scheduleNext();
}
