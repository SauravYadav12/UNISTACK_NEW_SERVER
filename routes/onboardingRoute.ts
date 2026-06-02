/**
 * Onboarding routes — admin surface only. Public candidate-facing
 * endpoints live in `publicOnboardingRoute.ts` and bypass JWT auth.
 *
 * All endpoints here require admin OR super-admin. The template
 * editor PATCH is tightened to super-admin only.
 */

import express from "express";
import passport from "passport";
import {
  anyRoleGuard,
  roleGuard,
} from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  listCandidates,
  getCandidate,
  createCandidate,
  requestInfo,
  markInfoReceived,
  startBgCheck,
  completeBgCheck,
  sendOffer,
  resendLink,
  rejectCandidate,
  deleteCandidate,
  getOfferLetterTemplateDoc,
  updateOfferLetterTemplate,
} from "../controllers/onboardingController";

const auth = passport.authenticate("jwt", { session: false });
const adminOrSuper = anyRoleGuard(UserRole.Admin, UserRole.SuperAdmin);
const superOnly = roleGuard(UserRole.SuperAdmin);

const onboardingRoute = express.Router();

// Candidates ──────────────────────────────────────────────────────
onboardingRoute.get("/candidates", auth, adminOrSuper, listCandidates);
onboardingRoute.get("/candidates/:id", auth, adminOrSuper, getCandidate);
onboardingRoute.post("/candidates", auth, adminOrSuper, createCandidate);
onboardingRoute.post(
  "/candidates/:id/request-info",
  auth,
  adminOrSuper,
  requestInfo,
);
onboardingRoute.post(
  "/candidates/:id/mark-info-received",
  auth,
  adminOrSuper,
  markInfoReceived,
);
onboardingRoute.post(
  "/candidates/:id/start-bg-check",
  auth,
  adminOrSuper,
  startBgCheck,
);
onboardingRoute.post(
  "/candidates/:id/complete-bg-check",
  auth,
  adminOrSuper,
  completeBgCheck,
);
onboardingRoute.post(
  "/candidates/:id/send-offer",
  auth,
  adminOrSuper,
  sendOffer,
);
onboardingRoute.post(
  "/candidates/:id/resend-link",
  auth,
  adminOrSuper,
  resendLink,
);
onboardingRoute.post(
  "/candidates/:id/reject",
  auth,
  adminOrSuper,
  rejectCandidate,
);
// Hard delete — cascades to S3 + tokens. Super-admin only.
onboardingRoute.delete(
  "/candidates/:id",
  auth,
  superOnly,
  deleteCandidate,
);

// Offer letter template ───────────────────────────────────────────
onboardingRoute.get("/template", auth, adminOrSuper, getOfferLetterTemplateDoc);
onboardingRoute.patch("/template", auth, superOnly, updateOfferLetterTemplate);

export { onboardingRoute };
