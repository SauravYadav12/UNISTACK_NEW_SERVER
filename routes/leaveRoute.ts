import { Router } from "express";

import passport from "passport";
import {
  createLeave,
  deleteLeave,
  getLeaveById,
  getLeaves,
  updateLeave,
} from "../controllers/leaveController";
const leaveRoute = Router();

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
