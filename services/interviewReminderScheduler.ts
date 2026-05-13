import moment from "moment-timezone";
import { InterviewModel } from "../models/interviewModel";
import { RequirementModel } from "../models/requirementModel";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { emitNotification } from "./notificationService";

/**
 * Daily reminder for confirmed interviews scheduled for *today*. Fans out
 * one notification per interview to:
 *   - every active super-admin (leadership visibility)
 *   - the assigned marketer (`marketingPersonRef`)
 *   - the support owner of the linked requirement (`reqEnteredByRef`,
 *     walked up to the parent if the interview hangs off a child)
 *
 * The cron ticks once at 09:00 America/New_York — that's the start of the
 * US shift's workday, which also lands at ~18:30 IST (EDT/summer) or
 * ~19:30 IST (EST/winter), so the India team picks it up in their evening.
 * `moment-timezone` resolves DST automatically so the local 09:00 anchor
 * stays consistent across the year.
 *
 * Per-interview dedupe keys (`interview-today:<intId>:<YYYY-MM-DD>`) make
 * re-runs in the same 24h idempotent — a manual scheduler restart won't
 * double-notify.
 *
 * The `interviewDate` field is a string formatted `YYYY/MM/DD` on the model
 * (see `pages/Marketing/Interviews/interviewValues.ts` — `dateFormate`).
 * Exact-string match on today's IST date is the right query — matches the
 * same filter the dashboard's TodayTimeline uses.
 */

const SCHEDULE_TZ = "America/New_York"; // anchor for the daily tick
const QUERY_TZ = "Asia/Kolkata"; // calendar reference for "today" in queries
const TICK_HOUR = 9; // 09:00 in SCHEDULE_TZ
const CONFIRMED_STATUS = "Interview Confirm";
const DATE_FORMAT = "YYYY/MM/DD"; // mirrors client `dateFormate` constant

function msUntilNextTick(): number {
  const now = moment.tz(SCHEDULE_TZ);
  let next = now.clone().hour(TICK_HOUR).minute(0).second(0).millisecond(0);
  if (next.isSameOrBefore(now)) next = next.add(1, "day");
  return next.valueOf() - Date.now();
}

let scheduledTimer: NodeJS.Timeout | null = null;

function scheduleNext() {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  const ms = msUntilNextTick();
  scheduledTimer = setTimeout(async () => {
    try {
      await runTick();
    } catch (e) {
      console.error("[interview-reminder] tick failed:", e);
    } finally {
      scheduleNext();
    }
  }, ms);
  const fireAt = moment.tz(SCHEDULE_TZ).add(ms, "milliseconds").format("LLLL z");
  console.log(`[interview-reminder] Next tick scheduled for ${fireAt}`);
}

async function runTick() {
  const today = moment.tz(QUERY_TZ).format(DATE_FORMAT);
  const dedupeDay = moment.tz(QUERY_TZ).format("YYYY-MM-DD");
  console.log(`[interview-reminder] Running tick for ${today}`);

  // Pull every confirmed interview scheduled for today. Includes Client,
  // Vendor, and IMP rounds — the user wants the agenda regardless of who
  // the interview is with (vendors and prep rounds still need to happen
  // on schedule). Filter to confirmed-only so cancelled/rescheduled rows
  // don't bubble up.
  const interviews = await InterviewModel.find({
    interviewDate: today,
    interviewStatus: CONFIRMED_STATUS,
  } as Record<string, unknown>)
    .select(
      "intId reqID marketingPersonRef interviewWith interviewTime timeZone companyName",
    )
    .lean();

  if (interviews.length === 0) {
    console.log("[interview-reminder] No confirmed interviews today.");
    return;
  }

  // Pre-fetch the super-admin list once per tick — same recipients for every
  // interview on a given day.
  const superAdminIds = await UserModel.distinct("_id", {
    role: UserRole.SuperAdmin,
    active: true,
  });

  // Pre-fetch support owners (reqEnteredByRef) for every reqID in today's
  // batch. Walks parents when the interview is bound to a child requirement.
  const reqIDs = Array.from(
    new Set(interviews.map((i) => i.reqID).filter(Boolean) as string[]),
  );
  const reqs = reqIDs.length
    ? await RequirementModel.find({
        reqID: { $in: reqIDs },
      })
        .select("reqID parentReqID reqEnteredByRef")
        .lean()
    : [];
  const reqByID = new Map(reqs.map((r) => [r.reqID, r]));

  // For any child interview whose parent isn't already in the map, pull the
  // parent so we can read its `reqEnteredByRef` (children inherit it on
  // creation, but we double-check).
  const missingParents = new Set<string>();
  for (const r of reqs) {
    if (r.parentReqID && !reqByID.has(r.parentReqID)) {
      missingParents.add(r.parentReqID);
    }
  }
  if (missingParents.size > 0) {
    const parents = await RequirementModel.find({
      reqID: { $in: [...missingParents] },
    })
      .select("reqID reqEnteredByRef")
      .lean();
    for (const p of parents) reqByID.set(p.reqID, p);
  }

  let emitted = 0;
  for (const iv of interviews) {
    const linked = iv.reqID ? reqByID.get(iv.reqID) : undefined;
    const supportRef =
      linked?.reqEnteredByRef ||
      (linked?.parentReqID
        ? reqByID.get(linked.parentReqID)?.reqEnteredByRef
        : undefined);

    const recipients: unknown[] = [
      ...superAdminIds,
      iv.marketingPersonRef,
      supportRef,
    ];

    const whenLine = [iv.interviewTime, iv.timeZone].filter(Boolean).join(" ");
    void emitNotification({
      recipients: recipients as Array<string>,
      type: "INTERVIEW_TODAY_REMINDER",
      title: `Interview today: ${iv.intId}${
        iv.interviewWith ? ` (${iv.interviewWith})` : ""
      }`,
      body: `${iv.intId} on ${iv.reqID || "—"} is confirmed for today${
        whenLine ? ` at ${whenLine}` : ""
      }.`,
      link: { kind: "interview", intId: iv.intId, reqID: iv.reqID },
      // Per-interview-per-day dedupe — re-runs in the same 24h window are
      // idempotent so a manual scheduler kick doesn't double-notify.
      dedupeKey: `interview-today:${iv.intId}:${dedupeDay}`,
    });
    emitted++;
  }
  console.log(
    `[interview-reminder] Tick done — ${emitted}/${interviews.length} interviews notified.`,
  );
}

export function initInterviewReminderScheduler(): void {
  scheduleNext();
}

// Exposed for manual test invocation.
export const __testables = { runTick };
