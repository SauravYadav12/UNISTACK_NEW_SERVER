import express from "express";
const vendorsRoute = express.Router();
import passport from "passport";
import {
  getAllInterviews,
  createInterview,
  updateInterview,
  deleteInterview,
} from "../controllers/vendorController";

vendorsRoute.get(
  "/get-interviews",
  passport.authenticate("jwt", { session: false }),
  getAllInterviews
);

vendorsRoute.post(
  "/create-interview",
  passport.authenticate("jwt", { session: false }),
  createInterview
);

vendorsRoute.patch(
  "/update-interview/:id",
  passport.authenticate("jwt", { session: false }),
  updateInterview
);

vendorsRoute.delete(
  "/delete-interview/:id",
  passport.authenticate("jwt", { session: false }),
  deleteInterview
);

export { vendorsRoute };
