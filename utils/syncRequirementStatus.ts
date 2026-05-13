import { RequirementModel } from "../models/requirementModel";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { emitNotification } from "../services/notificationService";

// Requirement lifecycle (informational):
//   New Working → Submission in progress → Submitted → Interviewed → Project Active → Project Inactive
// "Cancelled" is an explicit off-ramp and can happen at any point.
const TERMINAL_STATUSES = new Set([
  "Project Active",
  "Project Inactive",
  "Cancelled",
]);

// Statuses that an "Interview Completed" event can upgrade to "Interviewed".
// "Submission in progress" is included so an interview booked while the
// consultant was still being prepped (and never formally re-marked Submitted)
// still gets credited to Interviewed when the interview wraps up.
const PRE_INTERVIEWED_STATUSES = new Set([
  "New Working",
  "Submission in progress",
  "Submitted",
]);

interface SyncInput {
  reqID?: string | null;
  interviewStatus?: string | null;
  intResult?: string | null;
  updatedBy?: string;
}

/**
 * When an interview progresses, automatically advance the linked requirement:
 *   - intResult === "Offer"          → reqStatus "Project Active"
 *   - interviewStatus === "Interview Completed" → reqStatus "Interviewed"
 *
 * Rules:
 *   - Never overwrites terminal statuses (Project Active / Project Inactive /
 *     Cancelled). "Offer" is the only signal that can set Project Active, and
 *     once there it shouldn't be regressed to Interviewed by a later Completed.
 *   - "Interviewed" only upgrades from New Working / Submitted — not from
 *     Project Active / Project Inactive / Cancelled / Interviewed itself.
 *   - Any error is caught and logged; the caller's main update must not fail.
 */
export async function syncReqStatusFromInterview({
  reqID,
  interviewStatus,
  intResult,
  updatedBy,
}: SyncInput): Promise<void> {
  if (!reqID) return;

  const isOffer = intResult === "Offer";
  const isCompleted = interviewStatus === "Interview Completed";
  if (!isOffer && !isCompleted) return;

  try {
    const requirement = await RequirementModel.findOne({ reqID });
    if (!requirement) return;

    const current = requirement.reqStatus;

    let next: string | null = null;
    if (isOffer) {
      // Do not regress or overwrite a deliberately set terminal state —
      // operators own Project Active/Inactive/Cancelled transitions.
      if (!TERMINAL_STATUSES.has(current || "")) {
        next = "Project Active";
      }
    } else if (isCompleted && PRE_INTERVIEWED_STATUSES.has(current || "")) {
      next = "Interviewed";
    }

    if (!next) return;

    await RequirementModel.updateOne(
      { _id: requirement._id },
      { $set: { reqStatus: next, ...(updatedBy ? { updatedBy } : {}) } }
    );

    // Events 4 & 5 — auto-promotion notifications. Tell the marketer who
    // owns the requirement and the support person who entered it. For
    // Project Active (a closed-won deal), super-admins get pinged too.
    const recipients: Array<unknown> = [
      requirement.assignedToRef,
      requirement.reqEnteredByRef,
    ].filter(Boolean);

    if (next === "Project Active") {
      const superAdminIds = await UserModel.distinct("_id", {
        role: UserRole.SuperAdmin,
      });
      for (const sid of superAdminIds) recipients.push(sid);
    }

    void emitNotification({
      recipients: recipients as Array<string>,
      type:
        next === "Project Active"
          ? "REQUIREMENT_PROJECT_ACTIVE"
          : "REQUIREMENT_INTERVIEWED",
      title:
        next === "Project Active"
          ? `${requirement.reqID} won — Project Active!`
          : `${requirement.reqID} reached Interviewed`,
      body:
        next === "Project Active"
          ? `Offer accepted on ${requirement.reqID}. Auto-promoted to Project Active.`
          : `${requirement.reqID} auto-promoted to Interviewed after a client interview was marked completed.`,
      link: { kind: "requirement", reqID: requirement.reqID },
      // System-driven — no explicit actor.
    });
  } catch (err) {
    console.error("syncReqStatusFromInterview error:", err);
  }
}
