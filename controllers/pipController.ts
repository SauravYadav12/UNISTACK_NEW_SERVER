import { Request, Response } from "express";
import { FilterQuery, Types } from "mongoose";
import { PipModel, PipDoc } from "../models/pipModel";
import { UserModel } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { UserDoc } from "../interface";
import { UserRole } from "../enums/UserEnum";
import { sendMail } from "../utils/mailTransporter";
import { getPipTemplate } from "../templates";
import { mailSenders } from "../utils/mailSenders";
import {
  PIP_REASONS,
  PipReason,
  PIP_DAYS,
  addDays,
  computePipEndDate,
  buildDefaultPipEmail,
  buildPipFailedEmail,
  buildPipRemovedEmail,
} from "../utils/pip";

// ── helpers ──────────────────────────────────────────────────────────

function cleanReasons(input: unknown): PipReason[] {
  if (!Array.isArray(input)) return [];
  return input.filter((r): r is PipReason =>
    (PIP_REASONS as readonly string[]).includes(r as string)
  );
}

async function activeSuperAdmins(
  select: string
): Promise<Array<Record<string, unknown>>> {
  return UserModel.find(
    { role: UserRole.SuperAdmin, active: true } as FilterQuery<
      Record<string, unknown>
    >
  )
    .select(select)
    .lean();
}

/** HR mailbox used as the From/Reply-To and a CC target (same as onboarding). */
const HR_ADDRESS = mailSenders.onboarding.replyTo;

async function sendInitiationEmail(pip: PipDoc): Promise<void> {
  if (!pip.employeeEmail) {
    throw new Error("Employee has no email address on file.");
  }
  const html = await getPipTemplate({
    employeeName: pip.employeeName,
    body: pip.emailBody,
  });
  const superEmails = (await activeSuperAdmins("email"))
    .map((a) => a.email as string)
    .filter(Boolean);
  const cc = Array.from(new Set([HR_ADDRESS, ...superEmails].filter(Boolean)));
  await sendMail({
    from: mailSenders.onboarding.from,
    replyTo: mailSenders.onboarding.replyTo,
    to: pip.employeeEmail,
    cc,
    subject: pip.emailSubject,
    html,
  });
}

/** Send the initiation email, then (only on success) flip draft → active. */
async function activateAndSend(pip: PipDoc): Promise<void> {
  await sendInitiationEmail(pip);
  const now = new Date();
  pip.status = "active";
  pip.startDate = now;
  pip.originalEndDate = computePipEndDate(now, pip.durationDays);
  pip.endDate = pip.originalEndDate;
  pip.sentAt = now;
  await pip.save();
}

// ── controllers ─────────────────────────────────────────────────────

// POST /pip/preview — generate the default letter for the wizard's step 3.
export const previewPipDraft = async (req: Request, res: Response) => {
  try {
    const { employeeRef, reasons, otherReason } = req.body ?? {};
    const reasonsList = cleanReasons(reasons);
    if (!reasonsList.length) {
      res.status(400).json({ status: "failed", error: "Select at least one reason." });
      return;
    }
    let employeeName = "Employee";
    if (employeeRef && Types.ObjectId.isValid(String(employeeRef))) {
      const emp = await UserModel.findById(employeeRef)
        .select("firstName lastName email")
        .lean();
      if (emp) {
        employeeName =
          `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() ||
          emp.email ||
          "Employee";
      }
    }
    const data = buildDefaultPipEmail({
      employeeName,
      reasons: reasonsList,
      otherReason,
    });
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /pip — create a PIP (draft, or send immediately when body.send=true).
export const createPip = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const { employeeRef, reasons, otherReason, emailSubject, emailBody, send } =
      req.body ?? {};

    if (!employeeRef || !Types.ObjectId.isValid(String(employeeRef))) {
      res.status(400).json({ status: "failed", error: "A valid employee is required." });
      return;
    }
    const reasonsList = cleanReasons(reasons);
    if (!reasonsList.length) {
      res.status(400).json({ status: "failed", error: "Select at least one reason." });
      return;
    }
    if (reasonsList.includes("other") && !(otherReason && String(otherReason).trim())) {
      res.status(400).json({ status: "failed", error: "Please provide the specific reason for 'Other'." });
      return;
    }

    const employee = await UserModel.findById(employeeRef)
      .select("firstName lastName email")
      .lean();
    if (!employee) {
      res.status(404).json({ status: "failed", error: "Employee not found." });
      return;
    }
    const employeeName =
      `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() ||
      employee.email ||
      "Employee";
    const def = buildDefaultPipEmail({
      employeeName,
      reasons: reasonsList,
      otherReason,
    });

    const pip = new PipModel({
      employeeRef,
      employeeName,
      employeeEmail: employee.email || "",
      reasons: reasonsList,
      otherReason: otherReason ? String(otherReason).trim() : undefined,
      emailSubject: (emailSubject && String(emailSubject).trim()) || def.subject,
      emailBody: (emailBody && String(emailBody).trim()) || def.body,
      status: "draft",
      durationDays: PIP_DAYS,
      createdByRef: me._id,
    });
    await pip.save();

    if (send) {
      try {
        await activateAndSend(pip);
      } catch (e) {
        // Keep the draft; tell the caller the email failed.
        res.status(502).json({
          status: "failed",
          error: `Saved as draft, but sending the email failed: ${(e as Error).message}`,
          data: pip,
        });
        return;
      }
    }
    res.status(201).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /pip?status=  — list (client buckets into Active/Successful/Failed).
export const listPips = async (req: Request, res: Response) => {
  try {
    const { status } = req.query as Record<string, string>;
    const filter: FilterQuery<PipDoc> = {};
    if (status && status !== "all") filter.status = status as never;
    const pips = await PipModel.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json({ data: pips });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /pip/:id
export const getPip = async (req: Request, res: Response) => {
  try {
    const pip = await PipModel.findById(req.params.id).lean();
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// PATCH /pip/:id — edit a draft only.
export const updatePip = async (req: Request, res: Response) => {
  try {
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "draft") {
      res.status(409).json({ status: "failed", error: `PIP is already ${pip.status} and can no longer be edited.` });
      return;
    }
    const { reasons, otherReason, emailSubject, emailBody } = req.body ?? {};
    if (reasons !== undefined) {
      const reasonsList = cleanReasons(reasons);
      if (!reasonsList.length) {
        res.status(400).json({ status: "failed", error: "Select at least one reason." });
        return;
      }
      pip.reasons = reasonsList;
    }
    if (otherReason !== undefined) pip.otherReason = String(otherReason).trim();
    if (emailSubject !== undefined) pip.emailSubject = String(emailSubject);
    if (emailBody !== undefined) pip.emailBody = String(emailBody);
    await pip.save();
    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /pip/:id/send — send a draft (begins tracking).
export const sendPip = async (req: Request, res: Response) => {
  try {
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "draft") {
      res.status(409).json({ status: "failed", error: `PIP is already ${pip.status}.` });
      return;
    }
    await activateAndSend(pip);
    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(502).json({ status: "failed", error: `Could not send the PIP email: ${String((error as Error).message || error)}` });
  }
};

// POST /pip/:id/extend  { days } — active only; shifts the end date.
export const extendPip = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0 || days > 180) {
      res.status(400).json({ status: "failed", error: "Enter a valid number of days (1–180)." });
      return;
    }
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "active") {
      res.status(409).json({ status: "failed", error: `Only an active PIP can be extended (this one is ${pip.status}).` });
      return;
    }
    // Extend from whichever is later — the current end (if still in the
    // future) or today — so a late review still grants the full extra days.
    const now = new Date();
    const base = pip.endDate && pip.endDate > now ? pip.endDate : now;
    pip.endDate = addDays(base, days);
    pip.extensionDays = (pip.extensionDays || 0) + days;
    pip.extensions.push({ days, at: new Date(), byRef: me._id });
    // New window → let the completion scheduler notify again when it elapses.
    pip.completionNotifiedAt = undefined;
    await pip.save();
    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /pip/:id/resolve  { outcome: 'successful'|'failed', note? }
export const resolvePip = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const outcome = String(req.body?.outcome || "");
    const note = req.body?.note ? String(req.body.note).trim() : undefined;
    if (outcome !== "successful" && outcome !== "failed") {
      res.status(400).json({ status: "failed", error: "outcome must be 'successful' or 'failed'." });
      return;
    }
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "active") {
      res.status(409).json({ status: "failed", error: `Only an active PIP can be resolved (this one is ${pip.status}).` });
      return;
    }

    pip.status = outcome;
    pip.resolutionNote = note;
    pip.resolvedAt = new Date();
    pip.resolvedByRef = me._id as Types.ObjectId;
    await pip.save();

    if (outcome === "failed") {
      // Deactivate the employee via the standard exit flow: flip active and
      // stamp relievingDate (if not already set) — same as user-management.
      try {
        await UserModel.findByIdAndUpdate(pip.employeeRef, { active: false });
        await UserProfileModel.updateOne(
          {
            user: pip.employeeRef,
            relievingDate: { $in: [null, undefined] },
          } as FilterQuery<Record<string, unknown>>,
          { $set: { relievingDate: new Date() } }
        );
      } catch (e) {
        console.error("[pip] deactivation failed:", (e as Error).message);
      }
      // Notify the employee of the outcome (non-fatal if email fails).
      try {
        if (pip.employeeEmail) {
          const { subject, body } = buildPipFailedEmail({
            employeeName: pip.employeeName,
          });
          const html = await getPipTemplate({
            employeeName: pip.employeeName,
            body,
          });
          await sendMail({
            from: mailSenders.onboarding.from,
            replyTo: mailSenders.onboarding.replyTo,
            to: pip.employeeEmail,
            subject,
            html,
          });
        }
      } catch (e) {
        console.error("[pip] outcome email failed:", (e as Error).message);
      }
    }

    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /pip/:id/resend — super-admin only. Re-send the SAME initiation email
// (subject/body + same CC) to the employee. Deliberately does NOT touch the
// PIP's dates or status — the window keeps running unchanged; only the resend
// audit (count + timestamp) is updated.
export const resendPip = async (req: Request, res: Response) => {
  try {
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "active") {
      res.status(409).json({ status: "failed", error: `Only an active PIP's email can be resent (this one is ${pip.status}).` });
      return;
    }
    try {
      await sendInitiationEmail(pip);
    } catch (e) {
      res.status(502).json({ status: "failed", error: `Could not resend the PIP email: ${String((e as Error).message || e)}` });
      return;
    }
    pip.resendCount = (pip.resendCount || 0) + 1;
    pip.lastResentAt = new Date();
    await pip.save();
    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /pip/:id/remove  { note? } — super-admin only. Take the employee OFF
// the plan: close the PIP as "removed" (the account STAYS active — unlike a
// failed PIP) and email them that they've been removed. Active PIPs only.
export const removePip = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const note = req.body?.note ? String(req.body.note).trim() : undefined;
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "active") {
      res.status(409).json({ status: "failed", error: `Only an active PIP can be removed (this one is ${pip.status}).` });
      return;
    }

    pip.status = "removed";
    pip.resolutionNote = note;
    pip.resolvedAt = new Date();
    pip.resolvedByRef = me._id as Types.ObjectId;
    await pip.save();

    // Tell the employee they've been taken off the PIP (non-fatal if it fails).
    try {
      if (pip.employeeEmail) {
        const { subject, body } = buildPipRemovedEmail({
          employeeName: pip.employeeName,
        });
        const html = await getPipTemplate({
          employeeName: pip.employeeName,
          body,
        });
        await sendMail({
          from: mailSenders.onboarding.from,
          replyTo: mailSenders.onboarding.replyTo,
          to: pip.employeeEmail,
          subject,
          html,
        });
      }
    } catch (e) {
      console.error("[pip] removal email failed:", (e as Error).message);
    }

    res.status(200).json({ data: pip });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// DELETE /pip/:id — remove a draft only.
export const deletePip = async (req: Request, res: Response) => {
  try {
    const pip = await PipModel.findById(req.params.id);
    if (!pip) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    if (pip.status !== "draft") {
      res.status(409).json({ status: "failed", error: "Only a draft PIP can be deleted." });
      return;
    }
    await pip.deleteOne();
    res.status(200).json({ data: { _id: pip._id } });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};
