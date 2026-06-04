import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getSalaryConfig,
  upsertSalaryConfig,
  generateSlipsForMonth,
  generateSlipForUser,
  getSlipsForMonth,
  getMySlip,
  getMySlipsList,
  getMonthlyReportCsv,
  syncHolidays,
  updateSlip,
  publishSlip,
  unpublishSlip,
  publishSlipsForMonth,
} from "../controllers/salaryController";

const auth = passport.authenticate("jwt", { session: false });
const adminOrSuper = anyRoleGuard(UserRole.Admin, UserRole.SuperAdmin);
const hrOrAdminOrSuper = anyRoleGuard(
  UserRole.Admin,
  UserRole.SuperAdmin,
  UserRole.Hr,
);

const salaryRoute = express.Router();

salaryRoute.get("/my-slip/:year/:month", auth, getMySlip);
salaryRoute.get("/my-slips", auth, getMySlipsList);

salaryRoute.get("/config/:userId", auth, hrOrAdminOrSuper, getSalaryConfig);
salaryRoute.patch("/config/:userId", auth, hrOrAdminOrSuper, upsertSalaryConfig);

salaryRoute.post(
  "/generate/:year/:month",
  auth,
  adminOrSuper,
  generateSlipsForMonth,
);
salaryRoute.post(
  "/generate/:userId/:year/:month",
  auth,
  adminOrSuper,
  generateSlipForUser,
);
salaryRoute.get("/slips/:year/:month", auth, adminOrSuper, getSlipsForMonth);
salaryRoute.patch("/slip/:slipId", auth, adminOrSuper, updateSlip);
salaryRoute.post("/slip/:slipId/publish", auth, adminOrSuper, publishSlip);
salaryRoute.post("/slip/:slipId/unpublish", auth, adminOrSuper, unpublishSlip);
salaryRoute.post(
  "/publish/:year/:month",
  auth,
  adminOrSuper,
  publishSlipsForMonth,
);
salaryRoute.get(
  "/report/:year/:month.csv",
  auth,
  adminOrSuper,
  getMonthlyReportCsv,
);

salaryRoute.post("/holidays/sync/:year", auth, adminOrSuper, syncHolidays);

export { salaryRoute };
