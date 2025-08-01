import { Router } from "express";

import passport from "passport";
import {
  deleteHoliday,
  getHolidays,
  markHoliday,
  updateHoliday,
} from "../controllers/holidayController";
import { roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
const holidayRoute = Router();

holidayRoute.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  roleGuard(UserRole.SuperAdmin),
  markHoliday
);
holidayRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  roleGuard(UserRole.SuperAdmin),
  updateHoliday
);
holidayRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getHolidays
);

holidayRoute.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  roleGuard(UserRole.SuperAdmin),
  deleteHoliday
);

export { holidayRoute };
