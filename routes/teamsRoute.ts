import express from "express";
const teamsRoute = express.Router();
import passport from "passport";
import {
  getAllTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} from "../controllers/teamController";

teamsRoute.get(
  "/get-teams",
  passport.authenticate("jwt", { session: false }),
  getAllTeams
);

teamsRoute.post(
  "/create-team",
  passport.authenticate("jwt", { session: false }),
  createTeam
);

teamsRoute.patch(
  "/update-team/:id",
  passport.authenticate("jwt", { session: false }),
  updateTeam
);

teamsRoute.delete(
  "/delete-team/:id",
  passport.authenticate("jwt", { session: false }),
  deleteTeam
);

export { teamsRoute };
