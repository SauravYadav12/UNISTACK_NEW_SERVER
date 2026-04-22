import express from "express";
import passport from "passport";
import { anyRoleGuard, roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  approveApproval,
  getApproval,
  getApprovalById,
  listApprovals,
  rejectApproval,
  submitForApproval,
} from "../controllers/timesheetApprovalController";

const timesheetApprovalRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const writers = anyRoleGuard(
  UserRole.SuperAdmin,
  UserRole.Admin,
  UserRole.ProjectCoordinator
);
const superOnly = roleGuard(UserRole.SuperAdmin);

timesheetApprovalRoute.get("/", jwt, getApproval);
// NB: `/list` MUST be declared before `/:id` — otherwise Express matches
// "list" as an ObjectId param and the controller ObjectId cast blows up.
timesheetApprovalRoute.get("/list", jwt, listApprovals);
timesheetApprovalRoute.get("/:id", jwt, getApprovalById);
timesheetApprovalRoute.post("/submit", jwt, writers, submitForApproval);
timesheetApprovalRoute.post("/:id/approve", jwt, superOnly, approveApproval);
timesheetApprovalRoute.post("/:id/reject", jwt, superOnly, rejectApproval);

export { timesheetApprovalRoute };
