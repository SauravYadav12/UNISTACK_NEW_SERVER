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
  updateCandidateDetails,
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
  getOnboardingDocTemplates,
  updateOnboardingDocTemplate,
} from "../controllers/onboardingController";

const auth = passport.authenticate("jwt", { session: false });
// HR users handle day-to-day onboarding operations (create
// candidates, request info, send offers, mark BG-check passed/failed,
// reject candidates). Super-admin retains exclusive access to the
// destructive + structural operations: hard-delete a candidate
// (cascades to S3) and edit the document templates.
const adminOrSuper = anyRoleGuard(
  UserRole.Admin,
  UserRole.SuperAdmin,
  UserRole.Hr,
);
const superOnly = roleGuard(UserRole.SuperAdmin);

const onboardingRoute = express.Router();

// Candidates ──────────────────────────────────────────────────────
onboardingRoute.get("/candidates", auth, adminOrSuper, listCandidates);
onboardingRoute.get("/candidates/:id", auth, adminOrSuper, getCandidate);
onboardingRoute.post("/candidates", auth, adminOrSuper, createCandidate);
// Edit the basic AddCandidate fields (name, email, phone, position,
// start date, salary, probation). Same role gate as the rest of the
// onboarding admin surface — admin, super-admin, HR.
onboardingRoute.patch(
  "/candidates/:id/details",
  auth,
  adminOrSuper,
  updateCandidateDetails,
);
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

// Additional doc templates (Employment Agreement, Code of Conduct,
// NDA, Leave Policy). GET returns all four active rows in one call.
// PATCH per kind, super-admin only — same convention as the offer
// letter template above.
onboardingRoute.get(
  "/doc-templates",
  auth,
  adminOrSuper,
  getOnboardingDocTemplates,
);
onboardingRoute.patch(
  "/doc-templates/:kind",
  auth,
  superOnly,
  updateOnboardingDocTemplate,
);

export { onboardingRoute };
