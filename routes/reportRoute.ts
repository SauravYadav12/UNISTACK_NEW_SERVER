import { Router } from "express";
import {
  getDashboardReport,
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
reportRoute.get(
  "/dashboard",
  passport.authenticate("jwt", { session: false }),
  getDashboardReport
);
export { reportRoute };
