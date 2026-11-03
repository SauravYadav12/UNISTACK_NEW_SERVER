/**
 * PIP (Performance Improvement Plan) routes.
 * JWT-authed + role-gated to Admin / Super-admin / HR (the roles allowed to
 * run PIPs). The PIP UI lives inside the super-admin-gated Employee
 * Management page, so page access is additionally controlled there.
 */
import express from "express";
import passport from "passport";
import { anyRoleGuard, roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  previewPipDraft,
  createPip,
  listPips,
  getPip,
  updatePip,
  sendPip,
  extendPip,
  resolvePip,
  resendPip,
  removePip,
  deletePip,
} from "../controllers/pipController";

const auth = passport.authenticate("jwt", { session: false });
const pipAccess = anyRoleGuard(
  UserRole.Admin,
  UserRole.SuperAdmin,
  UserRole.Hr
);
// Resend + remove are reserved for super-admins only.
const superAdminOnly = roleGuard(UserRole.SuperAdmin);

const pipRoute = express.Router();

pipRoute.get("/", auth, pipAccess, listPips);
pipRoute.post("/", auth, pipAccess, createPip);
pipRoute.post("/preview", auth, pipAccess, previewPipDraft);
pipRoute.get("/:id", auth, pipAccess, getPip);
pipRoute.patch("/:id", auth, pipAccess, updatePip);
pipRoute.post("/:id/send", auth, pipAccess, sendPip);
pipRoute.post("/:id/extend", auth, pipAccess, extendPip);
pipRoute.post("/:id/resolve", auth, pipAccess, resolvePip);
pipRoute.post("/:id/resend", auth, superAdminOnly, resendPip);
pipRoute.post("/:id/remove", auth, superAdminOnly, removePip);
pipRoute.delete("/:id", auth, pipAccess, deletePip);

export { pipRoute };
