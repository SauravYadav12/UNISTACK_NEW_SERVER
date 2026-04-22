import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getSettings,
  updateSettings,
  previewTemplate,
  runNow,
  clearSentFlagsForFuture,
} from "../controllers/holidayNoticeController";

const auth = passport.authenticate("jwt", { session: false });
const adminOnly = anyRoleGuard(UserRole.Admin, UserRole.SuperAdmin);

const holidayNoticeRoute = express.Router();

holidayNoticeRoute.get("/settings", auth, adminOnly, getSettings);
holidayNoticeRoute.patch("/settings", auth, adminOnly, updateSettings);
holidayNoticeRoute.get("/preview", auth, adminOnly, previewTemplate);
holidayNoticeRoute.post("/run-now", auth, adminOnly, runNow);
holidayNoticeRoute.post("/clear-sent-future", auth, adminOnly, clearSentFlagsForFuture);

export { holidayNoticeRoute };
