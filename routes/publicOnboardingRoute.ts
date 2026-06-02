/**
 * Public onboarding routes — mounted at `/p/onboarding`. No JWT
 * middleware. The long random token in the URL is the credential;
 * per-token rate limiting + single-use consumption + 60-day TTL
 * provide the rest of the safety net.
 */

import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  resolveToken,
  submitForm,
  signOffer,
  signAdditionalDoc,
} from "../controllers/publicOnboardingController";
import { uploadFile } from "../controllers/storageController";
import { validatePublicLinkToken } from "../services/publicLinkTokenService";

const publicOnboardingRoute = express.Router();

// 10MB cap on candidate doc uploads — generous for PDF resumes /
// salary slips, restrictive enough to block accidental megapixel
// images. Same in-memory pattern as the authenticated /storage routes.
const candidateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * Token guard for public uploads. Same validation as the controllers,
 * but factored out so multer + the upload handler can sit behind it.
 * Token must be a valid `onboarding-form` token (not the offer-letter
 * type — those don't have file fields).
 */
async function requireOnboardingToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = String(req.params.token || "");
  const result = await validatePublicLinkToken(raw, "onboarding-form");
  if (!result.ok) {
    res.status(410).json({ ok: false, reason: result.reason });
    return;
  }
  next();
}

publicOnboardingRoute.get("/:token", resolveToken);
publicOnboardingRoute.post("/:token/submit-form", submitForm);
publicOnboardingRoute.post("/:token/sign-offer", signOffer);
// Sign one of the four additional onboarding documents. The `:kind`
// path segment validates against the OnboardingDocKind enum inside
// the controller (employment-agreement, code-of-conduct, nda,
// leave-policy). The same offer-letter token authorises this — no
// separate token issuance needed.
publicOnboardingRoute.post(
  "/:token/sign-additional/:kind",
  signAdditionalDoc,
);
// Candidate file upload — reuses the same controller as the
// authenticated /storage/upload/docn route but gated by token.
publicOnboardingRoute.post(
  "/:token/upload",
  requireOnboardingToken,
  candidateUpload.single("file"),
  uploadFile,
);

export { publicOnboardingRoute };
