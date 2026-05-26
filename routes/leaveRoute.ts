import { Router } from "express";

import passport from "passport";
import {
  createLeave,
  deleteLeave,
  getLeaveById,
  getLeaves,
  getMyProbationStatus,
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
