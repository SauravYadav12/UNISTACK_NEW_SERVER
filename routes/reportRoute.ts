import { Router } from "express";
import {
  getInterviewReport,
  getMarketingReport,
  getSupportReport,
} from "../controllers/reportController";
const passport = require("passport");
const reportRoute = Router();

reportRoute.get(
  "/support",
  passport.authenticate("jwt", { session: false }),
  getSupportReport
);
reportRoute.get(
  "/marketing",
  passport.authenticate("jwt", { session: false }),
  getMarketingReport
);
reportRoute.get(
  "/interview",
  passport.authenticate("jwt", { session: false }),
  getInterviewReport
);

export { reportRoute };
