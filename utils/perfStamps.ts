import mongoose from "mongoose";
import { RequirementModel } from "../models/requirementModel";
import { InterviewModel } from "../models/interviewModel";

/**
 * Set-once timestamp stamps for the monotonic performance scoring system.
 *
 * Every scoring-worthy state transition (req hit Submitted, interview hit
 * Confirm, etc.) stamps a `_perf*At` field on the doc. We never overwrite
 * a stamp — the first transition into a state wins, so the point lands in
 * the period it actually occurred and stays there.
 *
 * All updates use an `{ $exists: false }` predicate so concurrent writes
 * and cron retries can't double-stamp. Errors are swallowed so a stamp
 * failure never breaks the underlying business write.
 */

const SUBMITTED_OR_BEYOND = new Set([
  "Submitted",
  "Interviewed",
  "Project Active",
  "Project Inactive",
]);

const INTERVIEWED_OR_BEYOND = new Set([
  "Interviewed",
  "Project Active",
]);

async function setOnceOnReq(
  id: mongoose.Types.ObjectId | string,
  field: string,
  now: Date,
): Promise<void> {
  try {
    await RequirementModel.updateOne(
      { _id: id, [field]: { $exists: false } },
      { $set: { [field]: now } },
    );
  } catch (e) {
    console.error(`[perf-stamp] req ${field} failed:`, e);
  }
}

async function setOnceOnInterview(
  id: mongoose.Types.ObjectId | string,
  field: string,
  now: Date,
): Promise<void> {
  try {
    await InterviewModel.updateOne(
      { _id: id, [field]: { $exists: false } },
      { $set: { [field]: now } },
    );
  } catch (e) {
    console.error(`[perf-stamp] interview ${field} failed:`, e);
  }
}

/**
 * Stamp every relevant requirement-status milestone implied by `reqStatus`.
 * Idempotent across calls and across "Submitted -> Interviewed -> Project
 * Active" forward jumps — earlier milestones get stamped too if they were
 * skipped (an admin pasting in a "Project Active" req still gets credited
 * for the submission step).
 */
export async function stampReqStatusMilestones(
  reqId: mongoose.Types.ObjectId | string,
  reqStatus: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!reqStatus) return;
  if (SUBMITTED_OR_BEYOND.has(reqStatus)) {
    await setOnceOnReq(reqId, "_perfSubmittedAt", now);
  }
  if (INTERVIEWED_OR_BEYOND.has(reqStatus)) {
    await setOnceOnReq(reqId, "_perfInterviewedAt", now);
  }
  if (reqStatus === "Project Active") {
    await setOnceOnReq(reqId, "_perfProjectActiveAt", now);
  }
  if (reqStatus === "Project Inactive") {
    await setOnceOnReq(reqId, "_perfProjectInactiveAt", now);
  }
}

/**
 * Stamp the interview-event milestones implied by `interviewStatus` /
 * `intResult`. Only client interviews matter for marketing scoring —
 * vendor / IMP prep rounds are skipped. "Interview Completed" implies
 * the interview was Confirmed at some point earlier in its lifecycle, so
 * we also forward-fill `_perfConfirmedAt` if it's still null.
 */
export async function stampInterviewMilestones(
  interviewId: mongoose.Types.ObjectId | string,
  args: {
    interviewWith?: string;
    interviewStatus?: string;
    intResult?: string;
  },
  now: Date = new Date(),
): Promise<void> {
  if (args.interviewWith !== "Client") return;

  if (
    args.interviewStatus === "Interview Confirm" ||
    args.interviewStatus === "Interview Completed"
  ) {
    await setOnceOnInterview(interviewId, "_perfConfirmedAt", now);
  }
  if (args.interviewStatus === "Interview Completed") {
    await setOnceOnInterview(interviewId, "_perfCompletedAt", now);
  }
  if (args.intResult === "Offer") {
    await setOnceOnInterview(interviewId, "_perfOfferAt", now);
  }
}

/**
 * Penalty-field set-once helpers — used by the daily cron when it detects
 * a threshold has been crossed.
 */
export async function stampReqPenalty(
  reqId: mongoose.Types.ObjectId | string,
  field:
    | "_perfStaleSubmissionFiredAt"
    | "_perfUnworkedPenaltyFiredAt"
    | "_perfUnprogressedPenaltyFiredAt",
  now: Date = new Date(),
): Promise<void> {
  await setOnceOnReq(reqId, field, now);
}

export async function stampInterviewPenalty(
  interviewId: mongoose.Types.ObjectId | string,
  field: "_perfStaleConfirmFiredAt",
  now: Date = new Date(),
): Promise<void> {
  await setOnceOnInterview(interviewId, field, now);
}
