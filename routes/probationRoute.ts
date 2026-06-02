/**
 * Probation workflow routes — admin-facing operations + the personal
 * status endpoint is exposed via /leaves/me/probation (see leaveRoute).
 */

import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  listPendingProbations,
  confirmProbation,
  extendProbation,
  listEmployeesWithJoiningDates,
  updateEmployeeJoiningDate,
} from "../controllers/probationController";

const auth = passport.authenticate("jwt", { session: false });
// HR + admin + super-admin can call these. The client-side ACL
// matrix (managed under /access-control) decides which specific
// admin / HR users see the menu entry; the server stays role-gated
// at this coarser level so the API can't be hit by a regular
// employee even if the client gate is bypassed. HR is included
// here so super-admin can delegate probation + employee management
// operations to an HR Coordinator role.
const adminOrSuper = anyRoleGuard(
  UserRole.Admin,
  UserRole.SuperAdmin,
  UserRole.Hr,
);

const probationRoute = express.Router();

// Probation lifecycle ─────────────────────────────────────────────
probationRoute.get("/pending", auth, adminOrSuper, listPendingProbations);
probationRoute.post("/:userId/confirm", auth, adminOrSuper, confirmProbation);
probationRoute.post("/:userId/extend", auth, adminOrSuper, extendProbation);

// Joining-date management ─────────────────────────────────────────
// `/probation/...` is a slight URL misnomer — these endpoints serve
// the broader Employee Management page, not probation specifically.
// Kept under this prefix to avoid a second route file for now.
probationRoute.get(
  "/employees",
  auth,
  adminOrSuper,
  listEmployeesWithJoiningDates,
);
probationRoute.patch(
  "/employees/:userId/joining-date",
  auth,
  adminOrSuper,
  updateEmployeeJoiningDate,
);

export { probationRoute };
