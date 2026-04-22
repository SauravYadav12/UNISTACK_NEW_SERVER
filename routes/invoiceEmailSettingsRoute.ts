import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getSettings,
  updateSettings,
} from "../controllers/invoiceEmailSettingsController";

const invoiceEmailSettingsRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const adminOnly = anyRoleGuard(UserRole.SuperAdmin, UserRole.Admin);

invoiceEmailSettingsRoute.get("/", jwt, getSettings);
invoiceEmailSettingsRoute.patch("/", jwt, adminOnly, updateSettings);

export { invoiceEmailSettingsRoute };
