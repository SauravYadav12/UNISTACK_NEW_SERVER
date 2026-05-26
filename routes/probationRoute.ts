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
} from "../controllers/probationController";

const auth = passport.authenticate("jwt", { session: false });
// Admin OR super-admin can call these. The client-side ACL matrix
// (managed under /access-control) decides which roles see the menu
// entry. Server stays role-gated at this coarser level so the API
// can't be hit by a regular employee even if the client gate is
// bypassed.
const adminOrSuper = anyRoleGuard(UserRole.Admin, UserRole.SuperAdmin);

const probationRoute = express.Router();

probationRoute.get("/pending", auth, adminOrSuper, listPendingProbations);
probationRoute.post("/:userId/confirm", auth, adminOrSuper, confirmProbation);
probationRoute.post("/:userId/extend", auth, adminOrSuper, extendProbation);

export { probationRoute };
