import { RequirementModel } from "../models/requirementModel";

// Requirement lifecycle (informational):
//   New Working → Submitted → Interviewed → Project Active → Project Inactive
// "Cancelled" is an explicit off-ramp and can happen at any point.
const TERMINAL_STATUSES = new Set([
  "Project Active",
  "Project Inactive",
  "Cancelled",
]);

const PRE_INTERVIEWED_STATUSES = new Set(["New Working", "Submitted"]);

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
  } catch (err) {
    console.error("syncReqStatusFromInterview error:", err);
  }
}
