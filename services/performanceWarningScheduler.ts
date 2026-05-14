import moment from "moment-timezone";
import { RequirementModel } from "../models/requirementModel";
import { InterviewModel } from "../models/interviewModel";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { getWeights } from "../models/performanceWeightsModel";
import { emitNotification } from "./notificationService";
import { stampReqPenalty, stampInterviewPenalty } from "../utils/perfStamps";

/**
 * Daily proactive-warning scheduler. Mirrors the leaveBalanceScheduler
 * pattern: self-scheduling setTimeout loop, runs at 09:00 IST every day.
 *
 * It reuses the *same* threshold weights the performance leaderboard uses
 * (`STALE_SUBMISSION_DAYS`, `UNWORKED_REQ_DAYS`, `STALE_CONFIRM_DAYS`,
 * `UNPROGRESSED_REQ_DAYS`) but fires the alert `PROACTIVE_LEAD_DAYS` earlier
 * — so a marketer hears about a stale-submission risk *before* the penalty
 * actually lands.
 *
 * Aggregates per user (one bell row for "5 stale-soon submissions", not 5)
 * and de-dupes via the service's `dedupeKey` so re-runs in the same 24h
 * window don't double-notify.
 */

const TZ = "Asia/Kolkata";
const TICK_HOUR = 9;
const PROACTIVE_LEAD_DAYS = 2;

function msUntilNextTick(): number {
  const now = moment.tz(TZ);
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
      console.error("[perf-warning] tick failed:", e);
    } finally {
      scheduleNext();
    }
  }, ms);
  const fireAt = moment.tz(TZ).add(ms, "milliseconds").format("LLLL z");
  console.log(`[perf-warning] Next tick scheduled for ${fireAt}`);
}

interface DueGroup {
  recipient: unknown;
  reqIDs: string[];
}

/**
 * Group requirements/interviews by their owning user so we can emit one
 * aggregated notification per (user, type) instead of one per record.
 */
function groupByOwner(
  rows: Array<{ ownerRef?: unknown; reqID?: string | null }>,
): DueGroup[] {
  const byOwner = new Map<string, DueGroup>();
  for (const r of rows) {
    if (!r.ownerRef || !r.reqID) continue;
    const key = String(r.ownerRef);
    const existing = byOwner.get(key);
    if (existing) existing.reqIDs.push(r.reqID);
    else byOwner.set(key, { recipient: r.ownerRef, reqIDs: [r.reqID] });
  }
  return [...byOwner.values()];
}

async function runTick() {
  console.log("[perf-warning] Running tick");
  const now = new Date();

  // Pull current threshold values — admins may have tuned them since boot.
  const marketingWeights = (await getWeights("marketing")).weights;
  const supportWeights = (await getWeights("support")).weights;

  const staleSubDays = Number(marketingWeights.STALE_SUBMISSION_DAYS) || 14;
  const unworkedDays = Number(marketingWeights.UNWORKED_REQ_DAYS) || 7;
  const staleConfDays = Number(marketingWeights.STALE_CONFIRM_DAYS) || 14;
  const unprogressedDays = Number(supportWeights.UNPROGRESSED_REQ_DAYS) || 14;

  // We treat anyone whose `updatedAt` is older than `(threshold - lead)` days
  // as "imminent" — they're inside the warning window but not yet penalized.
  function cutoffDate(thresholdDays: number): Date {
    const cutoff = new Date(now.getTime());
    cutoff.setDate(cutoff.getDate() - (thresholdDays - PROACTIVE_LEAD_DAYS));
    return cutoff;
  }

  // ── Stale-submission imminent (marketing) ──────────────────────────────
  const staleSubCutoff = cutoffDate(staleSubDays);
  const staleSubReqs = await RequirementModel.find({
    reqStatus: "Submitted",
    updatedAt: { $lt: staleSubCutoff },
    assignedToRef: { $exists: true },
  } as Record<string, unknown>)
    .select("reqID assignedToRef")
    .lean();
  const staleSubGroups = groupByOwner(
    staleSubReqs.map((r) => ({ ownerRef: r.assignedToRef, reqID: r.reqID })),
  );
  for (const g of staleSubGroups) {
    void emitNotification({
      recipients: [g.recipient as string],
      type: "PERF_STALE_SUBMISSION",
      title: `${g.reqIDs.length} submission${g.reqIDs.length > 1 ? "s" : ""} going stale`,
      body: `You have ${g.reqIDs.length} submission${g.reqIDs.length > 1 ? "s" : ""} that haven't moved in a while. ${PROACTIVE_LEAD_DAYS} day${PROACTIVE_LEAD_DAYS > 1 ? "s" : ""} left to act before the stale-submission penalty applies.`,
      link: { kind: "filter", filterReqIDs: g.reqIDs },
      dedupeKey: `perf:stale-sub:${moment.tz(TZ).format("YYYY-MM-DD")}`,
    });
  }

  // ── Unworked requirement imminent (marketing) ──────────────────────────
  const unworkedCutoff = cutoffDate(unworkedDays);
  const unworkedReqs = await RequirementModel.find({
    reqStatus: "New Working",
    updatedAt: { $lt: unworkedCutoff },
    assignedToRef: { $exists: true },
    parentReqID: { $exists: true, $ne: "" }, // only child assignments; parents get noise-cancelled
  } as Record<string, unknown>)
    .select("reqID assignedToRef")
    .lean();
  const unworkedGroups = groupByOwner(
    unworkedReqs.map((r) => ({ ownerRef: r.assignedToRef, reqID: r.reqID })),
  );
  for (const g of unworkedGroups) {
    void emitNotification({
      recipients: [g.recipient as string],
      type: "PERF_UNWORKED_REQ",
      title: `${g.reqIDs.length} new-working position${g.reqIDs.length > 1 ? "s" : ""} need attention`,
      body: `You have ${g.reqIDs.length} new-working position${g.reqIDs.length > 1 ? "s" : ""}. ${PROACTIVE_LEAD_DAYS} day${PROACTIVE_LEAD_DAYS > 1 ? "s" : ""} left to act before the unworked-requirement penalty applies.`,
      link: { kind: "filter", filterReqIDs: g.reqIDs },
      dedupeKey: `perf:unworked:${moment.tz(TZ).format("YYYY-MM-DD")}`,
    });
  }

  // ── Stale confirmed interview imminent (marketing) ─────────────────────
  // "interviewDate older than (STALE_CONFIRM_DAYS − lead) days" — i.e. the
  // scheduled date has already passed by enough that the penalty is close.
  const staleConfCutoff = cutoffDate(staleConfDays);
  const staleConfIvs = await InterviewModel.find({
    interviewStatus: "Interview Confirm",
    interviewWith: "Client",
    interviewDate: { $lt: staleConfCutoff },
    marketingPersonRef: { $exists: true },
  } as Record<string, unknown>)
    .select("intId reqID marketingPersonRef")
    .lean();
  const staleConfGroups = groupByOwner(
    staleConfIvs.map((i) => ({
      ownerRef: i.marketingPersonRef,
      reqID: i.reqID,
    })),
  );
  for (const g of staleConfGroups) {
    void emitNotification({
      recipients: [g.recipient as string],
      type: "PERF_STALE_CONFIRMED",
      title: `${g.reqIDs.length} confirmed interview${g.reqIDs.length > 1 ? "s" : ""} past their date`,
      body: `You have ${g.reqIDs.length} confirmed interview${g.reqIDs.length > 1 ? "s" : ""} whose scheduled date has passed without being completed. Move them to Completed or update the status to avoid the stale-confirm penalty.`,
      link: { kind: "filter", filterReqIDs: g.reqIDs },
      dedupeKey: `perf:stale-conf:${moment.tz(TZ).format("YYYY-MM-DD")}`,
    });
  }

  // ── Unprogressed entry imminent (support) ──────────────────────────────
  const unprogCutoff = cutoffDate(unprogressedDays);
  const unprogReqs = await RequirementModel.find({
    reqStatus: "New Working",
    updatedAt: { $lt: unprogCutoff },
    reqEnteredByRef: { $exists: true },
    parentReqID: { $exists: false },
  } as Record<string, unknown>)
    .select("reqID reqEnteredByRef")
    .lean();
  // Skip any parent that has children — the children are real work being done.
  const parentIds = unprogReqs.map((r) => r.reqID).filter(Boolean) as string[];
  const haveChildren = await RequirementModel.distinct("parentReqID", {
    parentReqID: { $in: parentIds },
  });
  const haveChildrenSet = new Set(haveChildren.map((x) => String(x)));
  const unprogFiltered = unprogReqs.filter(
    (r) => !haveChildrenSet.has(String(r.reqID)),
  );
  const unprogGroups = groupByOwner(
    unprogFiltered.map((r) => ({
      ownerRef: r.reqEnteredByRef,
      reqID: r.reqID,
    })),
  );
  for (const g of unprogGroups) {
    void emitNotification({
      recipients: [g.recipient as string],
      type: "PERF_UNPROGRESSED_REQ",
      title: `${g.reqIDs.length} requirement${g.reqIDs.length > 1 ? "s" : ""} you entered haven't progressed`,
      body: `${g.reqIDs.length} requirement${g.reqIDs.length > 1 ? "s" : ""} you entered ${g.reqIDs.length > 1 ? "are" : "is"} still in New Working. Re-pitch or reassign before the unprogressed penalty applies.`,
      link: { kind: "filter", filterReqIDs: g.reqIDs },
      dedupeKey: `perf:unprogressed:${moment.tz(TZ).format("YYYY-MM-DD")}`,
    });
  }

  // ── Penalty stamping pass ──────────────────────────────────────────────
  // The four blocks above emit "imminent" notifications at `threshold - 2`
  // days. This second pass uses the FULL threshold (no lead) and stamps
  // `_perf*FiredAt` on each doc that has actually crossed the line. The
  // stamp is permanent (the helper uses `$exists: false`) — penalty is
  // monotonic, surviving any later remediation by the marketer / support.
  // No additional notification fires here; the warning already went out,
  // and the leaderboard surfaces the penalty.
  function fullThresholdCutoff(thresholdDays: number): Date {
    const cutoff = new Date(now.getTime());
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    return cutoff;
  }

  // Stale-submission penalty (marketing)
  const staleSubFireCutoff = fullThresholdCutoff(staleSubDays);
  const staleSubFireReqs = await RequirementModel.find({
    reqStatus: "Submitted",
    updatedAt: { $lt: staleSubFireCutoff },
    _perfStaleSubmissionFiredAt: { $exists: false },
  } as Record<string, unknown>)
    .select("_id")
    .lean();
  for (const r of staleSubFireReqs) {
    void stampReqPenalty(r._id, "_perfStaleSubmissionFiredAt", now);
  }

  // Unworked-requirement penalty (marketing, per-child)
  const unworkedFireCutoff = fullThresholdCutoff(unworkedDays);
  const unworkedFireReqs = await RequirementModel.find({
    reqStatus: "New Working",
    updatedAt: { $lt: unworkedFireCutoff },
    assignedToRef: { $exists: true },
    parentReqID: { $exists: true, $ne: "" },
    _perfUnworkedPenaltyFiredAt: { $exists: false },
  } as Record<string, unknown>)
    .select("_id")
    .lean();
  for (const r of unworkedFireReqs) {
    void stampReqPenalty(r._id, "_perfUnworkedPenaltyFiredAt", now);
  }

  // Stale-confirmed-interview penalty (marketing)
  const staleConfFireCutoff = fullThresholdCutoff(staleConfDays);
  const staleConfFireIvs = await InterviewModel.find({
    interviewStatus: "Interview Confirm",
    interviewWith: "Client",
    interviewDate: { $lt: staleConfFireCutoff },
    _perfStaleConfirmFiredAt: { $exists: false },
  } as Record<string, unknown>)
    .select("_id")
    .lean();
  for (const i of staleConfFireIvs) {
    void stampInterviewPenalty(i._id, "_perfStaleConfirmFiredAt", now);
  }

  // Unprogressed entry penalty (support, parent without children)
  const unprogFireCutoff = fullThresholdCutoff(unprogressedDays);
  const unprogFireReqs = await RequirementModel.find({
    reqStatus: "New Working",
    updatedAt: { $lt: unprogFireCutoff },
    reqEnteredByRef: { $exists: true },
    parentReqID: { $exists: false },
    _perfUnprogressedPenaltyFiredAt: { $exists: false },
  } as Record<string, unknown>)
    .select("_id reqID")
    .lean();
  // Exclude parents that have any child assignments — those count as worked-on.
  const fireParentIds = unprogFireReqs.map((r) => r.reqID).filter(Boolean) as string[];
  const haveChildrenForFire = await RequirementModel.distinct("parentReqID", {
    parentReqID: { $in: fireParentIds },
  });
  const haveChildrenFireSet = new Set(haveChildrenForFire.map((x) => String(x)));
  for (const r of unprogFireReqs) {
    if (haveChildrenFireSet.has(String(r.reqID))) continue;
    void stampReqPenalty(r._id, "_perfUnprogressedPenaltyFiredAt", now);
  }

  console.log(
    `[perf-warning] Tick done: stale-sub=${staleSubGroups.length}, unworked=${unworkedGroups.length}, stale-conf=${staleConfGroups.length}, unprogressed=${unprogGroups.length}; fired stamps: stale-sub=${staleSubFireReqs.length}, unworked=${unworkedFireReqs.length}, stale-conf=${staleConfFireIvs.length}, unprog=${unprogFireReqs.length}`,
  );

  // Ensure the user list is healthy — warns if the tick runs with no
  // marketers/supporters configured (so we know the cron isn't silently
  // running against an empty universe).
  if (
    staleSubGroups.length +
      unworkedGroups.length +
      staleConfGroups.length +
      unprogGroups.length ===
    0
  ) {
    const count = await UserModel.countDocuments({
      role: { $in: [UserRole.Marketing, UserRole.Support] },
      active: true,
    });
    if (count === 0) {
      console.warn(
        "[perf-warning] No active marketing/support users found — tick is a no-op by design.",
      );
    }
  }
}

export function initPerformanceWarningScheduler(): void {
  scheduleNext();
}

// Exported for manual / testing invocation from a REPL.
export const __testables = { runTick };
