import { Router } from "express";

import passport from "passport";
import {
  createLeave,
  deleteLeave,
  getLeaveById,
  getLeaves,
  getMyProbationStatus,
  revokeLeave,
  updateLeave,
} from "../controllers/leaveController";
const leaveRoute = Router();

// Place specific routes before `/:id` so they aren't swallowed by the
// generic getLeaveById matcher.
leaveRoute.get(
  "/me/probation",
  passport.authenticate("jwt", { session: false }),
  getMyProbationStatus,
);

leaveRoute.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  createLeave
);
leaveRoute.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  getLeaveById
);
leaveRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateLeave
);
// Revoke an Approved leave. HR / SuperAdmin only — the controller
// enforces the role check. Refuses if any month covered by the leave
// has a published SalarySlip.
leaveRoute.post(
  "/:id/revoke",
  passport.authenticate("jwt", { session: false }),
  revokeLeave,
);
leaveRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getLeaves
);

leaveRoute.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteLeave
);

export { leaveRoute };
