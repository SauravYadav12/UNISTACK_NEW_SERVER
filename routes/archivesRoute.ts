import { Router } from "express";
import passport from "passport";
import { getAllArchiveInterviews, getAllArchiveRequirements } from "../controllers/archivesController";

const archiveRoute = Router();

archiveRoute.get(
  "/requirements",
  passport.authenticate("jwt", { session: false }),
  getAllArchiveRequirements
);

archiveRoute.get(
  "/interviews",
  passport.authenticate("jwt", { session: false }),
  getAllArchiveInterviews
);

export { archiveRoute };
