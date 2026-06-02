/**
 * Public onboarding controller — surfaces the candidate-facing
 * endpoints under `/p/onboarding`. No JWT auth; the long random
 * token in the URL is the credential.
 *
 *   GET  /p/onboarding/:token            → resolve link state +
 *                                          minimum payload to render
 *                                          the form / offer page
 *   POST /p/onboarding/:token/submit-form
 *   POST /p/onboarding/:token/sign-offer
 *
 * All three call into `publicLinkTokenService` for validation. The
 * two POST handlers also mark the token consumed on success so the
 * same link can't be replayed.
 */

import { Request, Response } from "express";
import {
  OnboardingCandidateModel,
  OnboardingCandidateDoc,
} from "../models/onboardingCandidateModel";
import {
  validatePublicLinkToken,
  consumePublicLinkToken,
} from "../services/publicLinkTokenService";
import { sendMail } from "../utils/mailTransporter";
import { getOfferAcceptedTemplate } from "../templates";
import { notifyAdminsForCandidate, audit } from "./onboardingController";
import ENV_VARS from "../config/env.config";

const HR_FROM = ENV_VARS.HR_EMAIL_FROM || ENV_VARS.COMPANY_EMAIL || "";

// Lightweight per-token in-process rate limiter. 10 req/min ceiling
// matches the plan. Resets on server restart — acceptable for v1.
// Keyed by raw token; map size is bounded by active candidates which
// is small (HR-scale).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10;
const hits: Map<string, number[]> = new Map();

function rateLimit(token: string): boolean {
  const now = Date.now();
  const arr = (hits.get(token) || []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (arr.length >= RATE_MAX) {
    hits.set(token, arr);
    return false;
  }
  arr.push(now);
  hits.set(token, arr);
  return true;
}

// Strip server-only fields when handing a candidate doc to a
// public visitor. They get just enough to render the page.
function publicView(candidate: OnboardingCandidateDoc) {
  return {
    candId: candidate.candId,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    position: candidate.position,
    proposedStartDate: candidate.proposedStartDate,
    probationMonths: candidate.probationMonths,
    formData: candidate.formData,
    offer: candidate.offer,
    stage: candidate.stage,
  };
}

export const resolveToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const token = String(req.params.token || "");
  if (!rateLimit(token)) {
    res.status(429).json({ error: "Too many requests. Slow down." });
    return;
  }
  try {
    const result = await validatePublicLinkToken(token);
    if (!result.ok) {
      // Map all failure modes to a single 410 with a `reason` so the
      // candidate page can render the empathetic "link not available"
      // screen consistently.
      res.status(410).json({ ok: false, reason: result.reason });
      return;
    }
    const candidate = await OnboardingCandidateModel.findById(
      result.token.candidateRef,
    );
    if (!candidate) {
      res.status(404).json({ ok: false, reason: "candidate-missing" });
      return;
    }
    res.status(200).json({
      ok: true,
      data: {
        purpose: result.token.purpose,
        expiresAt: result.token.expiresAt,
        candidate: publicView(candidate),
      },
    });
  } catch (error) {
    console.error("[public-onboarding] resolve failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const submitForm = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const token = String(req.params.token || "");
  if (!rateLimit(token)) {
    res.status(429).json({ error: "Too many requests. Slow down." });
    return;
  }
  try {
    const result = await validatePublicLinkToken(token, "onboarding-form");
    if (!result.ok) {
      res.status(410).json({ ok: false, reason: result.reason });
      return;
    }
    const candidate = await OnboardingCandidateModel.findById(
      result.token.candidateRef,
    );
    if (!candidate) {
      res.status(404).json({ ok: false, reason: "candidate-missing" });
      return;
    }
    if (candidate.stage !== "invited" && candidate.stage !== "info-requested") {
      res.status(409).json({
        ok: false,
        reason: "wrong-stage",
        stage: candidate.stage,
      });
      return;
    }
    // Persist the form payload exactly as posted. Fields are
    // optional individually; the React form enforces required-ness.
    // Server-side parity validation for phone + email — catches
    // hand-crafted API calls that skip the form's checks. Phone is
    // normalised to digits; emails must match the basic format.
    const payload = (req.body || {}) as Record<string, unknown>;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PHONE_RE = /^\d{10}$/;
    if (typeof payload.phone === "string" && payload.phone) {
      const digits = payload.phone.replace(/\D/g, "");
      if (!PHONE_RE.test(digits)) {
        res.status(400).json({ error: "Phone must be exactly 10 digits." });
        return;
      }
      payload.phone = digits;
    }
    if (Array.isArray(payload.references)) {
      for (const r of payload.references as Array<Record<string, unknown>>) {
        if (typeof r.phone === "string" && r.phone) {
          const digits = r.phone.replace(/\D/g, "");
          if (!PHONE_RE.test(digits)) {
            res.status(400).json({
              error: "Reference phone must be exactly 10 digits.",
            });
            return;
          }
          r.phone = digits;
        }
        if (typeof r.email !== "string" || !EMAIL_RE.test(r.email.trim())) {
          res.status(400).json({
            error: "Each reference must have a valid email address.",
          });
          return;
        }
        r.email = r.email.trim();
      }
    }
    // Onboarding form no longer collects a signature — strip the
    // field defensively so a hand-crafted API call can't smuggle one
    // in. (Existing rows from before this change keep whatever was
    // saved earlier; the renderer is the one that ignores it now.)
    delete (payload as Record<string, unknown>).candidateSignatureDataUrl;
    candidate.formData = {
      ...(candidate.formData || {}),
      ...(payload as object),
      submittedAt: new Date(),
    };
    candidate.stage = "form-submitted";
    audit(candidate, "form-submitted", null);
    await candidate.save();
    await consumePublicLinkToken(result.token._id);

    // Tell HR.
    void notifyAdminsForCandidate({
      type: "onboarding.form-submitted",
      title: `${candidate.firstName} ${candidate.lastName} submitted their onboarding form`,
      body: `Open Employee Management → Onboarding to review and proceed.`,
      candidateRef: candidate._id,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[public-onboarding] submit failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const signOffer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const token = String(req.params.token || "");
  if (!rateLimit(token)) {
    res.status(429).json({ error: "Too many requests. Slow down." });
    return;
  }
  try {
    const result = await validatePublicLinkToken(token, "offer-letter");
    if (!result.ok) {
      res.status(410).json({ ok: false, reason: result.reason });
      return;
    }
    const candidate = await OnboardingCandidateModel.findById(
      result.token.candidateRef,
    );
    if (!candidate) {
      res.status(404).json({ ok: false, reason: "candidate-missing" });
      return;
    }
    if (candidate.stage !== "offer-sent") {
      res.status(409).json({
        ok: false,
        reason: "wrong-stage",
        stage: candidate.stage,
      });
      return;
    }
    if (!candidate.offer?.snapshot) {
      res.status(409).json({ ok: false, reason: "no-offer-snapshot" });
      return;
    }

    const {
      signatureDataUrl,
      signedFullName,
      signatureDate,
      signatureMode,
      signatureTypedName,
      geoLocation,
    } = (req.body || {}) as {
      signatureDataUrl?: string;
      signedFullName?: string;
      signatureDate?: string;
      signatureMode?: "drawn" | "typed";
      signatureTypedName?: string;
      geoLocation?: {
        latitude?: number;
        longitude?: number;
        accuracy?: number;
      };
    };

    const mode: "drawn" | "typed" =
      signatureMode === "typed" ? "typed" : "drawn";

    if (!signedFullName) {
      res.status(400).json({ error: "signedFullName is required." });
      return;
    }
    if (mode === "drawn") {
      // Drawn mode → require a valid image data URL.
      if (
        !signatureDataUrl ||
        typeof signatureDataUrl !== "string" ||
        !signatureDataUrl.startsWith("data:image/") ||
        signatureDataUrl.length > 5 * 1024 * 1024
      ) {
        res
          .status(400)
          .json({ error: "Invalid or missing signature image." });
        return;
      }
    } else {
      // Typed mode → require the typed name (the renderer paints it
      // in a cursive font; no image data URL needed).
      if (!signatureTypedName || !String(signatureTypedName).trim()) {
        res.status(400).json({
          error: "signatureTypedName is required for a typed signature.",
        });
        return;
      }
    }
    if (
      String(signedFullName).trim().toLowerCase() !==
      String(candidate.offer.snapshot.name).trim().toLowerCase()
    ) {
      res.status(400).json({
        error:
          "Signed name must match the name on the offer letter exactly.",
      });
      return;
    }

    candidate.offer.signatureMode = mode;
    if (mode === "drawn") {
      candidate.offer.signatureDataUrl = signatureDataUrl;
      // Clear any stale typed-name from a previous attempt.
      candidate.offer.signatureTypedName = undefined;
    } else {
      candidate.offer.signatureTypedName = String(signatureTypedName).trim();
      // We deliberately do NOT store a rasterized version of the typed
      // signature — the renderer paints the cursive name as live HTML
      // text so it stays crisp at any zoom level.
      candidate.offer.signatureDataUrl = undefined;
    }
    candidate.offer.signedFullName = String(signedFullName).trim();
    candidate.offer.signatureDate = signatureDate
      ? new Date(signatureDate)
      : new Date();
    candidate.offer.signedAt = new Date();

    // ── Digital verification metadata ─────────────────────────────
    // Email snapshot lets the verification stamp on the rendered
    // letter prove WHO signed it, independent of any later mutation
    // to the candidate's email on the record.
    candidate.offer.signedByEmail = candidate.email;
    // Capture the client IP. We honor X-Forwarded-For first because
    // the app sits behind Nginx in production, then fall back to the
    // socket address for local-dev runs.
    const xff = req.headers["x-forwarded-for"];
    const ipFromXff = Array.isArray(xff)
      ? String(xff[0] || "")
      : typeof xff === "string"
        ? xff
        : "";
    const ip = (ipFromXff.split(",")[0] || req.ip || "").trim();
    if (ip) candidate.offer.signedFromIp = ip;
    const ua = req.headers["user-agent"];
    if (typeof ua === "string" && ua) {
      candidate.offer.signedFromUserAgent = ua.slice(0, 500);
    }
    // Opt-in geolocation from the browser. Coerce to numbers + bounds
    // check — we'd rather drop a malformed payload than persist junk.
    if (
      geoLocation &&
      typeof geoLocation.latitude === "number" &&
      typeof geoLocation.longitude === "number" &&
      Math.abs(geoLocation.latitude) <= 90 &&
      Math.abs(geoLocation.longitude) <= 180
    ) {
      candidate.offer.signedFromLocation = {
        latitude: geoLocation.latitude,
        longitude: geoLocation.longitude,
        accuracy:
          typeof geoLocation.accuracy === "number"
            ? geoLocation.accuracy
            : undefined,
      };
    }

    candidate.stage = "offer-signed";
    // Mongoose doesn't auto-detect mutations on nested sub-docs unless
    // we mark the field modified.
    candidate.markModified("offer");
    audit(
      candidate,
      "offer-signed",
      null,
      `Signed as ${candidate.offer.signedFullName} (${mode}) · ${
        candidate.offer.signedFromIp || "no-ip"
      }`,
    );
    await candidate.save();
    // We intentionally do NOT consume the offer-letter token on sign.
    // Reasons:
    //   1. The stage check above (`stage === 'offer-sent'`) already
    //      prevents a second signature — the controller short-circuits
    //      with 409 if the candidate revisits the page and tries to
    //      sign again.
    //   2. Keeping the token valid lets the candidate revisit the link
    //      within its 60-day expiry to re-download the PDF, view the
    //      digital verification stamp, etc. Critical UX — otherwise
    //      losing the browser tab right after signing loses access to
    //      the signed copy.
    // The token still auto-expires via TTL and is revocable by HR.

    // Notify admins + send candidate a welcome confirmation.
    void notifyAdminsForCandidate({
      type: "onboarding.offer-signed",
      title: `${candidate.firstName} ${candidate.lastName} signed their offer`,
      body: `Onboarding is complete. Open Employee Management → Onboarding to view the signed offer.`,
      candidateRef: candidate._id,
    });
    try {
      const html = await getOfferAcceptedTemplate({
        firstName: candidate.firstName,
        position: candidate.offer.snapshot.position,
        startDate: candidate.offer.snapshot.startDate,
      });
      await sendMail({
        from: HR_FROM,
        replyTo: HR_FROM,
        to: candidate.email,
        subject: "Welcome aboard — we've received your signed offer",
        html,
      });
    } catch (e) {
      console.error("[onboarding] welcome email failed:", (e as Error).message);
    }

    // Return the updated candidate so the client can paint the
    // post-sign view (digital verification stamp + cursive name) using
    // the server's stored values without a second resolve round-trip.
    res.status(200).json({
      ok: true,
      data: { candidate: publicView(candidate) },
    });
  } catch (error) {
    console.error("[public-onboarding] sign failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};
