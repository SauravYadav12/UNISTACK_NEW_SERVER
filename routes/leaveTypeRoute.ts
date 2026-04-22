import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  getSuggestedCode,
  getUnpaidBucket,
} from "../controllers/leaveTypeController";
import {
  getMyBalances,
  getUserBalances,
  getYearBalances,
  updateAllocation,
  triggerYearlyReset,
} from "../controllers/leaveBalanceController";

const auth = passport.authenticate("jwt", { session: false });
const adminOrSuper = anyRoleGuard(UserRole.Admin, UserRole.SuperAdmin);

const leaveTypeRoute = express.Router();

// --- Leave types ---
leaveTypeRoute.get("/", auth, listLeaveTypes);
leaveTypeRoute.get("/suggest-code", auth, adminOrSuper, getSuggestedCode);
leaveTypeRoute.get("/unpaid-bucket", auth, getUnpaidBucket);
leaveTypeRoute.post("/", auth, adminOrSuper, createLeaveType);
leaveTypeRoute.patch("/:id", auth, adminOrSuper, updateLeaveType);
leaveTypeRoute.delete("/:id", auth, adminOrSuper, deleteLeaveType);

export { leaveTypeRoute };

const leaveBalanceRoute = express.Router();

leaveBalanceRoute.get("/my/:year", auth, getMyBalances);
leaveBalanceRoute.get("/my", auth, getMyBalances);
leaveBalanceRoute.get("/year/:year", auth, adminOrSuper, getYearBalances);
leaveBalanceRoute.get("/user/:userId/:year", auth, adminOrSuper, getUserBalances);
leaveBalanceRoute.patch(
  "/user/:userId/:year/:leaveTypeId",
  auth,
  adminOrSuper,
  updateAllocation,
);
leaveBalanceRoute.post("/reset/:year", auth, adminOrSuper, triggerYearlyReset);

export { leaveBalanceRoute };
