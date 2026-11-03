/**
 * Daily PIP-completion notification scheduler.
 *
 * Each day at 09:00 IST, finds every ACTIVE PIP whose effective end date
 * (`endDate`, which moves forward on extension) has elapsed and which hasn't
 * yet been flagged complete for that window, then:
 *   - fires an in-app notification to every active super-admin, and
 *   - emails those super-admins, once per window.
 *
 * `completionNotifiedAt` gates the email (set after notifying; cleared on
 * extension so a new window re-notifies). The in-app bell additionally
 * dedupes per (pip × endDate) via the dedupeKey. Mirrors the probation
 * scheduler's shape.
 */
import moment from "moment-timezone";
import { FilterQuery } from "mongoose";
import { PipModel } from "../models/pipModel";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { emitNotification } from "./notificationService";
import { sendMail } from "../utils/mailTransporter";
import { getPipTemplate } from "../templates";
import { mailSenders } from "../utils/mailSenders";

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
      console.error("[pip-cron] tick failed:", e);
    } finally {
      scheduleNext();
    }
  }, ms);
  const fireAt = moment.tz(TZ).add(ms, "milliseconds").format("LLLL z");
  console.log(`[pip-cron] Next tick scheduled for ${fireAt}`);
}

function isoDay(d: Date): string {
  return moment.tz(d, TZ).format("YYYY-MM-DD");
}

async function runTick(): Promise<void> {
  const today = new Date();

  const dueFilter = {
    status: "active",
    endDate: { $lte: today },
  } as FilterQuery<Record<string, unknown>>;
  const due = await PipModel.find(dueFilter);
  if (!due.length) {
    console.log("[pip-cron] No PIPs awaiting review.");
    return;
  }

  // Resolve recipients: every active super-admin (ids for the bell, emails
  // for the alert mail).
  const superAdmins = await UserModel.find(
    { role: UserRole.SuperAdmin, active: true } as FilterQuery<
      Record<string, unknown>
    >
  )
    .select("_id email")
    .lean();
  if (!superAdmins.length) {
    console.warn("[pip-cron] No active super-admins to notify.");
    return;
  }
  const recipientIds = superAdmins.map((r) => r._id);
  const superEmails = superAdmins
    .map((r) => r.email as string)
    .filter(Boolean);

  let notified = 0;
  for (const pip of due) {
    const endDate = pip.endDate ?? today;
    // Already notified for this window? (email-level dedupe)
    if (pip.completionNotifiedAt && pip.endDate && pip.completionNotifiedAt >= pip.endDate) {
      continue;
    }
    const endDay = isoDay(endDate);
    const name = pip.employeeName || "Employee";

    // In-app bell (dedup per pip × endDate).
    void emitNotification({
      recipients: recipientIds,
      type: "pip.review-due",
      title: `PIP completed: ${name}`,
      body: `${name}'s PIP window completed on ${endDay}. Open Employee Management → PIP to review and decide (extend, mark successful, or mark failed).`,
      link: { kind: "employee-management", employeeRef: String(pip.employeeRef) },
      dedupeKey: `pip-review:${pip._id}:${endDay}`,
    });

    // Email the super-admins (once per window).
    if (superEmails.length) {
      try {
        const body = [
          `A Performance Improvement Plan has reached the end of its window and needs a decision.`,
          ``,
          `Employee: ${name}`,
          `PIP period ended: ${endDay}`,
          ``,
          `Please open Unistack → Employee Management → PIP to review and either extend the plan, mark it successful, or mark it failed.`,
        ].join("\n");
        const html = await getPipTemplate({ employeeName: name, body });
        await sendMail({
          from: mailSenders.onboarding.from,
          replyTo: mailSenders.onboarding.replyTo,
          to: superEmails,
          subject: `PIP review required – ${name}`,
          html,
        });
      } catch (e) {
        console.error("[pip-cron] review email failed:", (e as Error).message);
      }
    }

    pip.completionNotifiedAt = new Date();
    await pip.save();
    notified++;
  }

  console.log(
    `[pip-cron] Notified ${notified} PIP(s) to ${recipientIds.length} super-admin(s).`
  );
}

export function startPipNotificationScheduler(): void {
  if (initialised) return;
  initialised = true;
  console.log("[pip-cron] starting");
  void runTick().catch((e) =>
    console.error("[pip-cron] initial tick failed:", e)
  );
  scheduleNext();
}
