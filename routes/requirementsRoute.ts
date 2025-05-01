import express from "express";
import {
  getAllRrequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
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

export { requirementRoute };
