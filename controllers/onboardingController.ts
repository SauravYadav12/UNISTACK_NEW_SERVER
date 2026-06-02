/**
 * Onboarding controller — admin-side endpoints powering the
 * Employee Management → Onboarding tab. Lifecycle:
 *
 *   create candidate → form sent → form submitted →
 *   (optional info request loop) → bg-check → bg-check-passed →
 *   offer sent → offer signed.
 *
 * Each transition handler validates the candidate's current stage
 * and 409s on mismatch so concurrent admin actions can't race the
 * candidate's own actions. The public surface lives in
 * `publicOnboardingController.ts`.
 *
 * Emails are sent via the existing nodemailer transporter; the `from`
 * field is set to `HR_EMAIL_FROM` so candidates see hr@unicodez.com.
 * Reply-to is the same so replies route to HR.
 *
 * Notifications to admins (via emitNotification) fire when a candidate
 * acts (form-submitted, offer-signed). The link points back at the
 * Employee Management page so a click lands on the onboarding tab.
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  OnboardingCandidateModel,
  OnboardingCandidateDoc,
  OnboardingStage,
  STAGE_PROGRESS_INDEX,
  ONBOARDING_TOTAL_STEPS,
  OnboardingOfferTemplateSnapshot,
  OnboardingOfferSnapshot,
  OnboardingAuditEntry,
} from "../models/onboardingCandidateModel";
import { OfferLetterTemplateModel } from "../models/offerLetterTemplateModel";
import { PublicLinkTokenModel } from "../models/publicLinkTokenModel";
import { UserModel, UserDoc } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { sequenceId } from "../utils/utils";
import { sendMail } from "../utils/mailTransporter";
import {
  getOnboardingInviteTemplate,
  getOnboardingInfoRequestTemplate,
  getBgCheckStartedTemplate,
  getOfferLetterTemplate,
  getOfferAcceptedTemplate,
} from "../templates";
import { issuePublicLinkToken } from "../services/publicLinkTokenService";
import { emitNotification } from "../services/notificationService";
import { deleteS3ObjectByUrl } from "./storageController";
import ENV_VARS from "../config/env.config";

const FRONTEND = ENV_VARS.FRONTEND_URL || "";
const HR_FROM = ENV_VARS.HR_EMAIL_FROM || ENV_VARS.COMPANY_EMAIL || "";

// Permissive cast for ad-hoc filter objects — same pattern other
// controllers use to bypass Mongoose's strict TS on filters that mix
// ObjectId / string / operator forms.
type AnyFilter = Record<string, unknown>;

function stageGuard(
  doc: OnboardingCandidateDoc,
  allowed: OnboardingStage[],
  res: Response,
): boolean {
  if (allowed.includes(doc.stage)) return true;
  res.status(409).json({
    error: `Cannot perform this action while candidate is in stage "${doc.stage}". Expected one of: ${allowed.join(", ")}.`,
  });
  return false;
}

/**
 * Append an entry to the candidate's audit log. Mutates the doc in
 * memory — caller is responsible for `await candidate.save()`. When
 * actor is `null` (candidate-side action via a public link) the
 * byName falls back to the candidate's own display name.
 */
export function audit(
  candidate: OnboardingCandidateDoc,
  action: string,
  actor: UserDoc | null,
  details?: string,
): void {
  const entry: OnboardingAuditEntry = {
    at: new Date(),
    by: actor?._id ?? null,
    byName: actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") ||
        actor.email ||
        "Admin"
      : `${candidate.firstName} ${candidate.lastName}`.trim() || "Candidate",
    action,
    details,
  };
  if (!Array.isArray(candidate.auditLog)) candidate.auditLog = [];
  candidate.auditLog.push(entry);
  // Mongoose needs the explicit mark when an array sub-doc is
  // mutated post-load; without it, save() may skip persisting.
  candidate.markModified("auditLog");
}

function buildFormUrl(token: string) {
  return `${FRONTEND}/onboarding/${token}`;
}
function buildOfferUrl(token: string) {
  return `${FRONTEND}/offer/${token}`;
}

function summary(doc: OnboardingCandidateDoc) {
  const idx = STAGE_PROGRESS_INDEX[doc.stage] || 0;
  return {
    _id: String(doc._id),
    candId: doc.candId,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    phone: doc.phone,
    position: doc.position,
    proposedStartDate: doc.proposedStartDate,
    proposedAnnualSalary: doc.proposedAnnualSalary,
    probationMonths: doc.probationMonths,
    stage: doc.stage,
    rejectionReason: doc.rejectionReason,
    progressIndex: idx,
    progressTotal: ONBOARDING_TOTAL_STEPS,
    progressPercent: Math.round((idx / ONBOARDING_TOTAL_STEPS) * 100),
    hasFormData: Boolean(doc.formData?.submittedAt),
    hasOffer: Boolean(doc.offer?.snapshot),
    hasSignedOffer: Boolean(doc.offer?.signedAt),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────
// LIST + DETAIL

export const listCandidates = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const docs = await OnboardingCandidateModel.find({})
      .sort({ updatedAt: -1 })
      .lean();
    res
      .status(200)
      .json({ data: docs.map((d) => summary(d as OnboardingCandidateDoc)) });
  } catch (error) {
    console.error("[onboarding] list failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getCandidate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const doc = await OnboardingCandidateModel.findById(id);
    if (!doc) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// CREATE

export const createCandidate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      proposedStartDate,
      proposedAnnualSalary,
      probationMonths = 3,
    } = req.body || {};

    if (!firstName || !lastName || !email || !position || !proposedStartDate || proposedAnnualSalary == null) {
      res.status(400).json({
        error:
          "firstName, lastName, email, position, proposedStartDate, and proposedAnnualSalary are all required.",
      });
      return;
    }

    // Server-side parity with the React validators. Catches direct
    // API calls that skip the form's checks (Postman / typo in the
    // client). Phone is optional, but when supplied must be 10 digits.
    const emailStr = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    if (phone) {
      const phoneDigits = String(phone).replace(/\D/g, "");
      if (!/^\d{10}$/.test(phoneDigits)) {
        res.status(400).json({ error: "Phone must be exactly 10 digits." });
        return;
      }
    }

    const candId = await sequenceId(OnboardingCandidateModel, "candId", "CAND");
    const candidate = await OnboardingCandidateModel.create({
      candId,
      firstName,
      lastName,
      email: emailStr.toLowerCase(),
      phone: phone ? String(phone).replace(/\D/g, "") : undefined,
      position,
      proposedStartDate: new Date(proposedStartDate),
      proposedAnnualSalary: Number(proposedAnnualSalary),
      probationMonths: Number(probationMonths) || 3,
      stage: "invited",
      invitedBy: admin._id,
    });
    // Seed the audit trail with the create event. Subsequent
    // transitions append via `audit()` + save().
    audit(
      candidate,
      "created",
      admin,
      `Created candidate · ${position} · start ${new Date(
        proposedStartDate,
      ).toDateString()}`,
    );
    await candidate.save();

    // Issue token + send invite. Non-fatal email failure: the
    // candidate row still exists; admin can resend from the UI.
    try {
      const token = await issuePublicLinkToken({
        candidateRef: candidate._id,
        purpose: "onboarding-form",
      });
      const html = await getOnboardingInviteTemplate({
        firstName: candidate.firstName,
        position: candidate.position,
        formUrl: buildFormUrl(token.token),
        expiresAt: token.expiresAt,
      });
      await sendMail({
        from: HR_FROM,
        replyTo: HR_FROM,
        to: candidate.email,
        subject: `Welcome to Unicodez — complete your onboarding`,
        html,
      });
    } catch (e) {
      console.error(
        "[onboarding] invite email failed for",
        candidate.candId,
        (e as Error).message,
      );
    }

    res.status(201).json({ data: summary(candidate) });
  } catch (error) {
    console.error("[onboarding] create failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// REQUEST MORE INFO

export const requestInfo = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const { subject, body } = req.body || {};
    if (!subject?.trim() || !body?.trim()) {
      res.status(400).json({ error: "subject and body are required." });
      return;
    }
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!stageGuard(candidate, ["form-submitted", "info-requested"], res))
      return;

    const html = await getOnboardingInfoRequestTemplate({
      firstName: candidate.firstName,
      subject,
      body,
    });
    await sendMail({
      from: HR_FROM,
      replyTo: HR_FROM,
      to: candidate.email,
      subject,
      html,
    });

    candidate.stage = "info-requested";
    audit(candidate, "info-requested", admin, `Subject: ${subject}`);
    await candidate.save();

    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    console.error("[onboarding] requestInfo failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const markInfoReceived = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!stageGuard(candidate, ["info-requested"], res)) return;
    candidate.stage = "form-submitted";
    audit(candidate, "info-received", admin);
    await candidate.save();
    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// BACKGROUND CHECK

export const startBgCheck = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!stageGuard(candidate, ["form-submitted"], res)) return;

    candidate.stage = "bg-check";
    candidate.bgCheckStartedAt = new Date();
    audit(candidate, "bg-check-started", admin);
    await candidate.save();

    try {
      const html = await getBgCheckStartedTemplate({
        firstName: candidate.firstName,
      });
      await sendMail({
        from: HR_FROM,
        replyTo: HR_FROM,
        to: candidate.email,
        subject: "Your background check has been initiated",
        html,
      });
    } catch (e) {
      console.error("[onboarding] bgcheck email failed:", (e as Error).message);
    }

    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const completeBgCheck = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const { passed, notes } = req.body || {};
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!stageGuard(candidate, ["bg-check"], res)) return;
    candidate.bgCheckCompletedAt = new Date();
    if (passed) {
      candidate.stage = "bg-check-passed";
      audit(candidate, "bg-check-passed", admin, notes || undefined);
    } else {
      candidate.stage = "rejected";
      candidate.rejectionReason =
        notes || "Background check did not pass.";
      audit(
        candidate,
        "bg-check-failed",
        admin,
        candidate.rejectionReason,
      );
    }
    await candidate.save();
    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// OFFER LETTER

async function getActiveTemplate() {
  let doc = await OfferLetterTemplateModel.findOne({ active: true });
  if (!doc) {
    // Auto-seed the default template on first use. Schema defaults
    // carry the reference letter wording (Anmol Shrivastava signatory,
    // Unicodez Softcorp Private Limited, etc.).
    doc = await OfferLetterTemplateModel.create({ active: true });
  }
  return doc;
}

function snapshotTemplate(
  t: NonNullable<Awaited<ReturnType<typeof getActiveTemplate>>>,
): OnboardingOfferTemplateSnapshot {
  return {
    salutationTemplate: t.salutationTemplate,
    bodyTemplate: t.bodyTemplate,
    termsTemplate: t.termsTemplate,
    closingTemplate: t.closingTemplate,
    signatoryName: t.signatoryName,
    signatoryTitle: t.signatoryTitle,
    companyName: t.companyName,
    companyAddress: t.companyAddress,
    companyEmail: t.companyEmail,
    companyWebsite: t.companyWebsite,
    directorSignatureDataUrl: t.directorSignatureDataUrl,
  };
}

export const sendOffer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const {
      name,
      position,
      startDate,
      annualSalary,
      probationMonths,
    } = req.body || {};
    if (!name || !position || !startDate || annualSalary == null || probationMonths == null) {
      res.status(400).json({
        error:
          "name, position, startDate, annualSalary, and probationMonths are all required.",
      });
      return;
    }
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!stageGuard(candidate, ["bg-check-passed", "offer-sent"], res)) return;
    const admin = req.user as UserDoc;

    const template = await getActiveTemplate();
    const snapshot: OnboardingOfferSnapshot = {
      name: String(name),
      position: String(position),
      startDate: new Date(startDate),
      annualSalary: Number(annualSalary),
      probationMonths: Number(probationMonths),
    };

    candidate.offer = {
      sentAt: new Date(),
      snapshot,
      templateAtSendTime: snapshotTemplate(template),
    };
    candidate.stage = "offer-sent";
    audit(
      candidate,
      "offer-sent",
      admin,
      `${snapshot.position} · start ${snapshot.startDate.toDateString()} · ₹${snapshot.annualSalary} LPA · ${snapshot.probationMonths}m probation`,
    );
    await candidate.save();

    // Issue offer-letter token + email.
    try {
      const token = await issuePublicLinkToken({
        candidateRef: candidate._id,
        purpose: "offer-letter",
      });
      const html = await getOfferLetterTemplate({
        firstName: candidate.firstName,
        position: snapshot.position,
        signUrl: buildOfferUrl(token.token),
      });
      await sendMail({
        from: HR_FROM,
        replyTo: HR_FROM,
        to: candidate.email,
        subject: `Your offer letter from Unicodez Softcorp`,
        html,
      });
    } catch (e) {
      console.error(
        "[onboarding] offer email failed for",
        candidate.candId,
        (e as Error).message,
      );
    }

    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    console.error("[onboarding] sendOffer failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const resendLink = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const purpose = String(req.body?.purpose || "");
    if (purpose !== "onboarding-form" && purpose !== "offer-letter") {
      res.status(400).json({
        error: "purpose must be 'onboarding-form' or 'offer-letter'.",
      });
      return;
    }
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }

    const token = await issuePublicLinkToken({
      candidateRef: candidate._id,
      purpose,
    });
    audit(
      candidate,
      purpose === "onboarding-form" ? "link-resent-onboarding" : "link-resent-offer",
      admin,
    );
    await candidate.save();

    try {
      if (purpose === "onboarding-form") {
        const html = await getOnboardingInviteTemplate({
          firstName: candidate.firstName,
          position: candidate.position,
          formUrl: buildFormUrl(token.token),
          expiresAt: token.expiresAt,
        });
        await sendMail({
          from: HR_FROM,
          replyTo: HR_FROM,
          to: candidate.email,
          subject: `Welcome to Unicodez — complete your onboarding`,
          html,
        });
      } else {
        if (!candidate.offer?.snapshot) {
          res.status(409).json({
            error: "No offer has been generated for this candidate yet.",
          });
          return;
        }
        const html = await getOfferLetterTemplate({
          firstName: candidate.firstName,
          position: candidate.offer.snapshot.position,
          signUrl: buildOfferUrl(token.token),
        });
        await sendMail({
          from: HR_FROM,
          replyTo: HR_FROM,
          to: candidate.email,
          subject: `Your offer letter from Unicodez Softcorp`,
          html,
        });
      }
    } catch (e) {
      console.error("[onboarding] resend email failed:", (e as Error).message);
    }

    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const rejectCandidate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const { reason } = req.body || {};
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    candidate.stage = "rejected";
    candidate.rejectionReason = String(reason || "").trim() || "No reason provided.";
    audit(candidate, "rejected", admin, candidate.rejectionReason);
    await candidate.save();
    res.status(200).json({ data: summary(candidate) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// HARD DELETE (super-admin only)

/**
 * Permanently removes a candidate record. Used when HR needs to clean
 * up test rows or fully erase a candidate's data (right-to-be-forgotten
 * style). Cascading cleanup:
 *
 *   1. Delete every file the candidate uploaded from S3 (resume, photo,
 *      PAN, address proof, degree copy, all salary slips, and the
 *      signed-offer signature is base64-on-doc so no S3 work needed).
 *   2. Delete every PublicLinkToken pointing at this candidate so any
 *      cached magic-links are dead.
 *   3. Delete the candidate doc itself (including the auditLog).
 *
 * The route layer enforces super-admin-only; this controller doesn't
 * re-check (defence in depth lives in the route guard).
 */
export const deleteCandidate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }

    const fileUrls: string[] = [];
    const docs = candidate.formData?.documents;
    if (docs) {
      if (docs.resume) fileUrls.push(docs.resume);
      if (docs.passportPhoto) fileUrls.push(docs.passportPhoto);
      if (docs.panCard) fileUrls.push(docs.panCard);
      if (docs.addressProof) fileUrls.push(docs.addressProof);
      if (docs.degreeCopy) fileUrls.push(docs.degreeCopy);
      if (Array.isArray(docs.lastThreeSalarySlips)) {
        fileUrls.push(...docs.lastThreeSalarySlips);
      }
    }

    // Fire all S3 deletes in parallel — `deleteS3ObjectByUrl` is
    // non-throwing (logs + returns false) so a transient credential
    // hiccup never blocks the row deletion.
    const s3Results = await Promise.all(
      fileUrls.map((u) => deleteS3ObjectByUrl(u)),
    );
    const filesRemoved = s3Results.filter(Boolean).length;

    // Drop any public-link tokens pointing at this candidate so any
    // stray copy of a magic link goes dead immediately.
    const tokenDelete = await PublicLinkTokenModel.deleteMany({
      candidateRef: candidate._id,
    });

    await OnboardingCandidateModel.deleteOne({ _id: candidate._id });

    console.log(
      `[onboarding] Candidate ${candidate.candId} hard-deleted ` +
        `(files=${filesRemoved}/${fileUrls.length}, ` +
        `tokens=${tokenDelete.deletedCount ?? 0}, ` +
        `by=${(req.user as UserDoc)?._id?.toString() || "unknown"})`,
    );

    res.status(200).json({
      data: {
        candId: candidate.candId,
        filesAttempted: fileUrls.length,
        filesRemoved,
        tokensRemoved: tokenDelete.deletedCount ?? 0,
      },
    });
  } catch (error) {
    console.error("[onboarding] delete failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// TEMPLATE EDITOR (super-admin only)

export const getOfferLetterTemplateDoc = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const doc = await getActiveTemplate();
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateOfferLetterTemplate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const fields = [
      "salutationTemplate",
      "bodyTemplate",
      "termsTemplate",
      "closingTemplate",
      "signatoryName",
      "signatoryTitle",
      "companyName",
      "companyAddress",
      "companyEmail",
      "companyWebsite",
      "directorSignatureDataUrl",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      // Allow explicit empty string to clear the director signature.
      if (typeof req.body?.[f] === "string") patch[f] = req.body[f];
    }
    if (!Object.keys(patch).length) {
      res.status(400).json({ error: "No template fields supplied." });
      return;
    }

    // Mark current active inactive, clone its values + apply patch
    // into a new active row. Versioned history = the collection.
    const current = await getActiveTemplate();
    await OfferLetterTemplateModel.updateOne(
      { _id: current._id } as AnyFilter,
      { $set: { active: false } },
    );
    const next = await OfferLetterTemplateModel.create({
      ...snapshotTemplate(current),
      ...patch,
      active: true,
      updatedBy: admin._id,
    });
    res.status(200).json({ data: next });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// Helper exposed to publicOnboardingController for sign-offer
// notifications, kept here to centralise admin-recipient logic.
export async function notifyAdminsForCandidate(args: {
  type: string;
  title: string;
  body: string;
  candidateRef: Types.ObjectId;
}): Promise<void> {
  const recipientFilter = {
    role: { $in: [UserRole.Admin, UserRole.SuperAdmin, UserRole.Hr] },
    active: true,
  } as AnyFilter;
  const recipients = await UserModel.distinct("_id", recipientFilter);
  if (!recipients.length) return;
  void emitNotification({
    recipients,
    type: args.type,
    title: args.title,
    body: args.body,
    link: {
      kind: "employee-management",
      employeeRef: String(args.candidateRef),
    },
    dedupeKey: `${args.type}:${String(args.candidateRef)}`,
  });
}
