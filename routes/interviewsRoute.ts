import express from "express";
const interviewRoute = express.Router();
import passport from "passport";
import {
  getAllInterviews,
  createInterview,
  updateInterview,
  deleteInterview,
} from "../controllers/interviewController";

interviewRoute.get(
  "/get-interviews",
  passport.authenticate("jwt", { session: false }),
  getAllInterviews
);

interviewRoute.post(
  "/create-interview",
  passport.authenticate("jwt", { session: false }),
  createInterview
);

interviewRoute.patch(
  "/update-interview/:id",
  passport.authenticate("jwt", { session: false }),
  updateInterview
);

interviewRoute.delete(
  "/delete-interview/:id",
  passport.authenticate("jwt", { session: false }),
  deleteInterview
);

export { interviewRoute };
