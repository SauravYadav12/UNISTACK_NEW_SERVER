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
  OnboardingDocTemplateSnapshot,
} from "../models/onboardingCandidateModel";
import { OfferLetterTemplateModel } from "../models/offerLetterTemplateModel";
import {
  OnboardingDocTemplateModel,
  OnboardingDocTemplateDoc,
  OnboardingDocKind,
  ONBOARDING_DOC_KINDS,
  DEFAULT_DOC_TEMPLATES,
} from "../models/onboardingDocTemplateModel";
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
  getOnboardingRejectedTemplate,
} from "../templates";
import { issuePublicLinkToken } from "../services/publicLinkTokenService";
import { emitNotification } from "../services/notificationService";
import { deleteS3ObjectByUrl } from "./storageController";
import ENV_VARS from "../config/env.config";
import { mailSenders } from "../utils/mailSenders";

const FRONTEND = ENV_VARS.FRONTEND_URL || "";
// IMPORTANT — From/Reply-To split for deliverability:
//
// webhostbox-flavored cPanel SMTP servers (and most shared hosting MTAs)
// will silently drop outgoing mail whose `From:` header doesn't match the
// authenticated SMTP user, because they can only DKIM-sign for the user
// they validated against. Setting `from: hr@unicodez.com` while
// authenticating as `info@unicodez.com` produces 250 OK at submission
// then a silent failure at relay — exactly the symptom the team hit.
//
// Fix: send `from: SMTP_USER` (the address the server actually signs)
// and `replyTo: HR_EMAIL_FROM` so candidate replies still land in the
// HR inbox. The visible sender in the candidate's Gmail will be
// `info@unicodez.com`; clicking "Reply" auto-fills `hr@unicodez.com`.
// Pull the onboarding-category From/Reply-To from the centralised
// registry (see utils/mailSenders.ts). Display name + address are
// driven by ONBOARDING_MAIL_FROM + HR_EMAIL_FROM env vars; sensible
// defaults apply when unset.
const MAIL_FROM = mailSenders.onboarding.from;
const MAIL_REPLY_TO = mailSenders.onboarding.replyTo;

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

/**
 * Best-effort rejection email. Called from every rejection site
 * (explicit reject + bg-check failure). Non-throwing so an SMTP
 * hiccup never blocks the stage flip — the audit trail + DB are
 * always the source of truth, the email is courtesy.
 */
async function sendRejectionEmail(
  candidate: OnboardingCandidateDoc,
  variant: "bg-check" | "generic",
): Promise<void> {
  try {
    const html = await getOnboardingRejectedTemplate({
      firstName: candidate.firstName,
      position: candidate.position,
      reason:
        candidate.rejectionReason ||
        "We're unable to share specifics at this time.",
      variant,
    });
    await sendMail({
      from: MAIL_FROM,
      replyTo: MAIL_REPLY_TO,
      to: candidate.email,
      subject: `Update on your application — ${candidate.position}`,
      html,
    });
  } catch (e) {
    console.error(
      "[onboarding] rejection email failed for",
      candidate.candId,
      (e as Error).message,
    );
  }
}

function summary(doc: OnboardingCandidateDoc) {
  const idx = STAGE_PROGRESS_INDEX[doc.stage] || 0;
  return {
    _id: String(doc._id),
    candId: doc.candId,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    officialEmail: doc.officialEmail,
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
      officialEmail,
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
    // officialEmail is optional. Empty string ⇒ "not provided" (kept
    // undefined on the document). When supplied, validate the same
    // way as the primary email and lowercase on save below.
    const officialEmailStr =
      typeof officialEmail === "string" ? officialEmail.trim() : "";
    if (
      officialEmailStr &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officialEmailStr)
    ) {
      res.status(400).json({ error: "Enter a valid official email address." });
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
      officialEmail: officialEmailStr
        ? officialEmailStr.toLowerCase()
        : undefined,
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
        from: MAIL_FROM,
        replyTo: MAIL_REPLY_TO,
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
// EDIT CANDIDATE DETAILS (super-admin / admin / HR)
//
// HR sometimes realises after sending the invite that a name was typed
// wrong, the email is on the candidate's old domain, the position
// title needs a tweak, etc. Rather than delete + recreate (which kills
// any form progress the candidate has already made), this endpoint
// patches the existing record in place.
//
// `?reinvite=true` (or `reinvite: true` in body) additionally:
//   • Revokes the previous onboarding-form token (so a stale link sent
//     to the wrong email can't still be used).
//   • Issues a fresh token + sends a new invite email to the (now
//     corrected) address.
// Stage flips back to `invited` when re-inviting from any earlier
// pre-offer stage so the candidate sees a clean start.

export const updateCandidateDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const admin = req.user as UserDoc;
    const candidate = await OnboardingCandidateModel.findById(id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    // Don't allow editing terminal records — they're history.
    if (candidate.stage === "rejected" || candidate.stage === "onboarded") {
      res.status(409).json({
        error: `Cannot edit a candidate in stage "${candidate.stage}".`,
      });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const {
      firstName,
      lastName,
      email,
      officialEmail,
      phone,
      position,
      proposedStartDate,
      proposedAnnualSalary,
      probationMonths,
    } = body;
    const reinvite =
      body.reinvite === true ||
      body.reinvite === "true" ||
      req.query.reinvite === "true";

    if (
      !firstName ||
      !lastName ||
      !email ||
      !position ||
      !proposedStartDate ||
      proposedAnnualSalary == null
    ) {
      res.status(400).json({
        error:
          "firstName, lastName, email, position, proposedStartDate, and proposedAnnualSalary are all required.",
      });
      return;
    }
    const emailStr = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    // officialEmail is optional. Empty string clears the previously
    // saved value (HR may want to remove a wrong corporate email).
    const officialEmailStr =
      typeof officialEmail === "string" ? officialEmail.trim() : "";
    if (
      officialEmailStr &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officialEmailStr)
    ) {
      res.status(400).json({ error: "Enter a valid official email address." });
      return;
    }
    if (phone) {
      const phoneDigits = String(phone).replace(/\D/g, "");
      if (!/^\d{10}$/.test(phoneDigits)) {
        res.status(400).json({ error: "Phone must be exactly 10 digits." });
        return;
      }
    }

    // Capture a small diff for the audit entry so HR can later see what
    // was actually changed (and by whom).
    const changes: string[] = [];
    const trackChange = (label: string, oldV: unknown, newV: unknown) => {
      if (String(oldV ?? "") !== String(newV ?? "")) {
        changes.push(`${label}: "${oldV ?? ""}" → "${newV ?? ""}"`);
      }
    };
    trackChange("firstName", candidate.firstName, firstName);
    trackChange("lastName", candidate.lastName, lastName);
    trackChange("email", candidate.email, emailStr.toLowerCase());
    trackChange(
      "officialEmail",
      candidate.officialEmail || "",
      officialEmailStr ? officialEmailStr.toLowerCase() : "",
    );
    trackChange("phone", candidate.phone, phone || "");
    trackChange("position", candidate.position, position);
    trackChange(
      "startDate",
      candidate.proposedStartDate?.toDateString(),
      new Date(String(proposedStartDate)).toDateString(),
    );
    trackChange(
      "salary",
      candidate.proposedAnnualSalary,
      Number(proposedAnnualSalary),
    );
    trackChange(
      "probationMonths",
      candidate.probationMonths,
      Number(probationMonths) || 3,
    );

    candidate.firstName = String(firstName).trim();
    candidate.lastName = String(lastName).trim();
    candidate.email = emailStr.toLowerCase();
    // Persist the lowercased value when provided, or unset entirely
    // when HR sent an empty string (treat "" as "clear it").
    candidate.officialEmail = officialEmailStr
      ? officialEmailStr.toLowerCase()
      : undefined;
    candidate.phone = phone
      ? String(phone).replace(/\D/g, "")
      : undefined;
    candidate.position = String(position).trim();
    candidate.proposedStartDate = new Date(String(proposedStartDate));
    candidate.proposedAnnualSalary = Number(proposedAnnualSalary);
    candidate.probationMonths = Number(probationMonths) || 3;

    if (changes.length) {
      audit(
        candidate,
        "details-updated",
        admin,
        changes.join(" · "),
      );
    }

    // ── Stage-aware re-invite ──
    // The candidate's current stage determines what kind of link is
    // resent (and whether anything is resent at all):
    //
    //   invited / form-submitted / info-requested → onboarding form link
    //     (early lifecycle; stage rewinds to `invited` so the candidate
    //     can re-submit the form against the new details)
    //
    //   offer-sent → offer-letter link with a REVISED snapshot
    //     (re-stamp candidate.offer.snapshot with the new salary /
    //     position / dates so the freshly-issued link serves the
    //     correct numbers; revoke the old offer-letter token; reset any
    //     mid-flight signature state so the candidate signs the new
    //     terms; audit as `link-resent-offer`).
    //
    //   bg-check / bg-check-passed / offer-signed → no link to resend.
    //     (Details are still saved, but no email goes out. HR uses the
    //     stage-specific action panel button — e.g. "Generate offer
    //     letter" — for those flows.)
    //
    // `reinviteKind` is returned to the client so a precise toast can
    // be shown ("revised offer letter sent" vs. generic).
    type ReinviteKind = "onboarding-form" | "offer-letter" | null;
    let reinviteSent = false;
    let reinviteKind: ReinviteKind = null;

    if (reinvite) {
      const stage = candidate.stage;
      const isPreFormStage =
        stage === "invited" ||
        stage === "form-submitted" ||
        stage === "info-requested";

      if (isPreFormStage) {
        reinviteKind = "onboarding-form";
        // Best-effort revoke of old onboarding-form tokens so the
        // previous link goes dead before a new one is issued.
        try {
          await PublicLinkTokenModel.updateMany(
            {
              candidateRef: candidate._id,
              purpose: "onboarding-form",
              consumedAt: { $exists: false },
              revokedAt: { $exists: false },
            } as AnyFilter,
            { $set: { revokedAt: new Date() } },
          );
        } catch (e) {
          console.error(
            "[onboarding] revoke onboarding-form failed:",
            (e as Error).message,
          );
        }
        // Roll back to `invited` so the candidate restarts cleanly.
        candidate.stage = "invited";
      } else if (stage === "offer-sent") {
        reinviteKind = "offer-letter";
        // Re-snapshot the existing offer with the just-edited values.
        // Anything not part of the editable form (offer.snapshot.name)
        // is preserved if present so HR's manual override on the
        // original send isn't lost.
        if (candidate.offer) {
          const prevName = candidate.offer.snapshot?.name;
          candidate.offer.snapshot = {
            name:
              prevName ||
              `${candidate.firstName} ${candidate.lastName}`.trim(),
            position: candidate.position,
            startDate: candidate.proposedStartDate || new Date(),
            annualSalary: candidate.proposedAnnualSalary || 0,
            probationMonths: candidate.probationMonths || 3,
          };
          candidate.offer.sentAt = new Date();
          // Old signature state is invalidated by the revision — the
          // candidate is signing different terms now. Same goes for
          // any partially-signed additional docs from a previous
          // round of this offer (employment agreement, NDA, etc.).
          candidate.offer.signedAt = undefined;
          candidate.offer.signatureDataUrl = undefined;
          candidate.offer.signatureDate = undefined;
          candidate.offer.signedFullName = undefined;
          candidate.offer.signatureMode = undefined;
          candidate.offer.signatureTypedName = undefined;
          candidate.offer.signedByEmail = undefined;
          candidate.offer.signedFromIp = undefined;
          candidate.offer.signedFromUserAgent = undefined;
          candidate.offer.signedFromLocation = undefined;
          candidate.additionalSignedDocuments = [];
          candidate.additionalDocSnapshots = await snapshotAllAdditionalDocs();
        }
        // Revoke any active offer-letter tokens so the old (stale-
        // salary) URL is dead before the candidate clicks it.
        try {
          await PublicLinkTokenModel.updateMany(
            {
              candidateRef: candidate._id,
              purpose: "offer-letter",
              consumedAt: { $exists: false },
              revokedAt: { $exists: false },
            } as AnyFilter,
            { $set: { revokedAt: new Date() } },
          );
        } catch (e) {
          console.error(
            "[onboarding] revoke offer-letter failed:",
            (e as Error).message,
          );
        }
      }
      // bg-check / bg-check-passed / offer-signed: reinviteKind stays
      // null. No email goes out. The detail edits are still persisted
      // by the candidate.save() below.
    }

    await candidate.save();

    if (reinvite && reinviteKind) {
      try {
        const token = await issuePublicLinkToken({
          candidateRef: candidate._id,
          purpose: reinviteKind,
        });
        if (reinviteKind === "onboarding-form") {
          const html = await getOnboardingInviteTemplate({
            firstName: candidate.firstName,
            position: candidate.position,
            formUrl: buildFormUrl(token.token),
            expiresAt: token.expiresAt,
          });
          await sendMail({
            from: MAIL_FROM,
            replyTo: MAIL_REPLY_TO,
            to: candidate.email,
            subject: `Welcome to Unicodez — complete your onboarding`,
            html,
          });
          audit(candidate, "link-resent-onboarding", admin);
        } else {
          // offer-letter
          const html = await getOfferLetterTemplate({
            firstName: candidate.firstName,
            position:
              candidate.offer?.snapshot.position || candidate.position,
            signUrl: buildOfferUrl(token.token),
          });
          await sendMail({
            from: MAIL_FROM,
            replyTo: MAIL_REPLY_TO,
            to: candidate.email,
            subject: `Your revised offer letter from Unicodez Softcorp`,
            html,
          });
          audit(candidate, "link-resent-offer", admin);
        }
        await candidate.save();
        reinviteSent = true;
      } catch (e) {
        console.error(
          "[onboarding] re-invite email failed:",
          (e as Error).message,
        );
      }
    }

    res.status(200).json({
      data: { ...summary(candidate), reinviteSent, reinviteKind },
    });
  } catch (error) {
    console.error("[onboarding] update details failed:", (error as Error).message);
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
      from: MAIL_FROM,
      replyTo: MAIL_REPLY_TO,
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
        from: MAIL_FROM,
        replyTo: MAIL_REPLY_TO,
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
    // Email the candidate the moment we save the rejection. Fired
    // post-save so a transient SMTP issue never causes a half-rejected
    // state. The helper is non-throwing.
    if (!passed) {
      void sendRejectionEmail(candidate, "bg-check");
    }
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

/**
 * Fetch the active row for one of the four additional doc templates,
 * auto-seeding the default content from DEFAULT_DOC_TEMPLATES if no
 * row exists yet. Called for every kind by `getActiveDocTemplates`
 * (template editor read) and snapshot helpers (offer-send time).
 */
async function getActiveDocTemplate(
  kind: OnboardingDocKind,
): Promise<OnboardingDocTemplateDoc> {
  let doc = await OnboardingDocTemplateModel.findOne({ kind, active: true });
  if (!doc) {
    const seed = DEFAULT_DOC_TEMPLATES[kind];
    doc = await OnboardingDocTemplateModel.create({
      kind,
      title: seed.title,
      preamble: seed.preamble,
      sections: seed.sections,
      acknowledgment: seed.acknowledgment,
      active: true,
    });
  }
  return doc;
}

function snapshotDocTemplate(
  t: OnboardingDocTemplateDoc,
): OnboardingDocTemplateSnapshot {
  return {
    kind: t.kind,
    title: t.title,
    preamble: t.preamble,
    sections: t.sections.map((s) => ({ heading: s.heading, body: s.body })),
    acknowledgment: t.acknowledgment,
    signatoryName: t.signatoryName,
    signatoryTitle: t.signatoryTitle,
    companyName: t.companyName,
    companyAddress: t.companyAddress,
    companyEmail: t.companyEmail,
    companyWebsite: t.companyWebsite,
    directorSignatureDataUrl: t.directorSignatureDataUrl,
  };
}

/**
 * Snapshot all four additional doc templates in one go. Called from
 * `sendOffer` so the candidate signs the exact versions of the docs
 * that HR had active at offer-send time.
 */
async function snapshotAllAdditionalDocs(): Promise<OnboardingDocTemplateSnapshot[]> {
  const snapshots: OnboardingDocTemplateSnapshot[] = [];
  for (const kind of ONBOARDING_DOC_KINDS) {
    const t = await getActiveDocTemplate(kind);
    snapshots.push(snapshotDocTemplate(t));
  }
  return snapshots;
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
    // Capture the four additional doc templates so the candidate
    // signs the same wording HR had active at send-off, even if
    // super-admin edits the live templates afterward. Reset any
    // partial signatures from a previous offer cycle.
    candidate.additionalDocSnapshots = await snapshotAllAdditionalDocs();
    candidate.additionalSignedDocuments = [];
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
        from: MAIL_FROM,
        replyTo: MAIL_REPLY_TO,
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
          from: MAIL_FROM,
          replyTo: MAIL_REPLY_TO,
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
          from: MAIL_FROM,
          replyTo: MAIL_REPLY_TO,
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
    // Email the candidate with the reason. Non-blocking — the
    // rejection is already persisted in the DB.
    void sendRejectionEmail(candidate, "generic");
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

// ─────────────────────────────────────────────────────────────────────
// ADDITIONAL DOC TEMPLATES (super-admin only)

/**
 * Returns the active row of all four additional doc templates. Used
 * by the multi-template editor — left-rail navigation has one entry
 * per kind, this endpoint hydrates all four in a single call.
 */
export const getOnboardingDocTemplates = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const docs: Record<string, OnboardingDocTemplateDoc> = {};
    for (const kind of ONBOARDING_DOC_KINDS) {
      docs[kind] = await getActiveDocTemplate(kind);
    }
    res.status(200).json({ data: docs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateOnboardingDocTemplate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const kind = String(req.params.kind || "") as OnboardingDocKind;
    if (!ONBOARDING_DOC_KINDS.includes(kind)) {
      res.status(400).json({ error: `Unknown doc kind: ${kind}` });
      return;
    }

    // Pluck only the fields we accept from the body to avoid mass
    // assignment. Sections is a structured array; the rest are flat
    // strings. directorSignatureDataUrl accepts empty string to clear.
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const f of [
      "title",
      "preamble",
      "acknowledgment",
      "signatoryName",
      "signatoryTitle",
      "companyName",
      "companyAddress",
      "companyEmail",
      "companyWebsite",
      "directorSignatureDataUrl",
    ]) {
      if (typeof body[f] === "string") patch[f] = body[f];
    }
    if (Array.isArray(body.sections)) {
      const sections = (body.sections as Array<Record<string, unknown>>)
        .filter(
          (s) => typeof s?.heading === "string" && typeof s?.body === "string",
        )
        .map((s) => ({
          heading: String(s.heading).trim(),
          body: String(s.body),
        }));
      patch.sections = sections;
    }
    if (!Object.keys(patch).length) {
      res.status(400).json({ error: "No template fields supplied." });
      return;
    }

    // Versioned overwrite — mark current inactive, clone its values
    // and apply patch into a fresh active row.
    const current = await getActiveDocTemplate(kind);
    await OnboardingDocTemplateModel.updateOne(
      { _id: current._id } as AnyFilter,
      { $set: { active: false } },
    );
    const next = await OnboardingDocTemplateModel.create({
      kind,
      title: current.title,
      preamble: current.preamble,
      sections: current.sections,
      acknowledgment: current.acknowledgment,
      signatoryName: current.signatoryName,
      signatoryTitle: current.signatoryTitle,
      companyName: current.companyName,
      companyAddress: current.companyAddress,
      companyEmail: current.companyEmail,
      companyWebsite: current.companyWebsite,
      directorSignatureDataUrl: current.directorSignatureDataUrl,
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
