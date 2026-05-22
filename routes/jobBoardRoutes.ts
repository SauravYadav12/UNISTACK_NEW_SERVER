import { Router } from "express";
import passport from "passport";
import { searchJobs } from "../controllers/jobBoardController";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";

const jobBoardRoute = Router();

// Job Boards is a marketing/recruiting tool. Admin + SuperAdmin retain
// access for oversight and "Force refresh" — non-marketing users get a
// 403 even if they bypass the sidebar gate.
const jobBoardAccess = anyRoleGuard(
  UserRole.Marketing,
  UserRole.Admin,
  UserRole.SuperAdmin,
);

jobBoardRoute.post(
  "/search",
  passport.authenticate("jwt", { session: false }),
  jobBoardAccess,
  searchJobs,
);

export { jobBoardRoute };
