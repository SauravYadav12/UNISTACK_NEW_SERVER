import express from "express";
const interviewRoute = express.Router();
import passport from "passport";
import {
  getAllInterviews,
  createInterview,
  updateInterview,
  deleteInterview,
  getInterviewsForParent,
} from "../controllers/interviewController";

interviewRoute.get(
  "/get-interviews",
  passport.authenticate("jwt", { session: false }),
  getAllInterviews
);

interviewRoute.get(
  "/by-parent/:reqID",
  passport.authenticate("jwt", { session: false }),
  getInterviewsForParent
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
