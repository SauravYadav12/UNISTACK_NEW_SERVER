import express from "express";
import {
  getAllRrequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  createRequirementLog,
  getRequirementLog,
  requirementsCounts,
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
