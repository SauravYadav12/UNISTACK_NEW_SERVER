/**
 * "My Documents" routes — employee-facing surface for documents
 * already on file for the calling user. Currently serves their signed
 * onboarding paperwork (offer letter + 4 additional signed docs).
 *
 * Auth: JWT only. No role gate — every active user can view their own
 * documents. The controller scopes results to the caller's emails,
 * so a user can never see another user's docs.
 */

import express from "express";
import passport from "passport";
import { getMyOnboardingDocs } from "../controllers/myDocumentsController";

const auth = passport.authenticate("jwt", { session: false });

const myDocumentsRoute = express.Router();

myDocumentsRoute.get("/onboarding", auth, getMyOnboardingDocs);

export { myDocumentsRoute };
