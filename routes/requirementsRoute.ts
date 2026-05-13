import express from "express";
import {
  getAllRrequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  createRequirementLog,
  getRequirementLog,
  requirementsCounts,
  extractRequirementData,
  assignMarketers,
  unassignMarketer,
  searchRequirementByReqID,
  getPipelineCounts,
} from "../controllers/requirementController";
const requirementRoute = express.Router();
import passport from "passport";

requirementRoute.get(
  "/get-requirements",
  passport.authenticate("jwt", { session: false }),
  getAllRrequirements
);

requirementRoute.post(
  "/create-requirement",
  passport.authenticate("jwt", { session: false }),
  createRequirement
);

requirementRoute.post(
  "/extract-from-content",
  passport.authenticate("jwt", { session: false }),
  extractRequirementData
);

requirementRoute.patch(
  "/update-requirement/:id",
  passport.authenticate("jwt", { session: false }),
  updateRequirement
);

requirementRoute.delete(
  "/delete-requirement/:id",
  passport.authenticate("jwt", { session: false }),
  deleteRequirement
);

requirementRoute.get(
  '/count-by-date',
  passport.authenticate('jwt', { session: false }),
  requirementsCounts
)

// Aggregated pipeline-tile counts — one request returning every count the
// `PipelineSnapshot` widget needs (replaces ~10 separate `reqStatus=...`
// list calls from the client).
requirementRoute.get(
  '/pipeline-counts',
  passport.authenticate('jwt', { session: false }),
  getPipelineCounts
);

// ── Multi-assign ────────────────────────────────────────────────────────
requirementRoute.post(
  '/:reqID/assignments',
  passport.authenticate('jwt', { session: false }),
  assignMarketers
);

requirementRoute.delete(
  '/assignments/:id',
  passport.authenticate('jwt', { session: false }),
  unassignMarketer
);

requirementRoute.get(
  '/search/:reqID',
  passport.authenticate('jwt', { session: false }),
  searchRequirementByReqID
);

// -------------------logs-----------------

requirementRoute.get(
  "/get-log",
  passport.authenticate("jwt", { session: false }),
  getRequirementLog
);

requirementRoute.post(
  "/create-log",
  passport.authenticate("jwt", { session: false }),
  createRequirementLog
);

export { requirementRoute };
