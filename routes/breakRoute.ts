import { Router } from "express";
import passport from "passport";
import {
  start,
  idle,
  requestUnlockOtp,
  stop,
  current,
  logs,
  summary,
  openBreaks,
  forceEnd,
  stream,
  getPolicy,
  putPolicy,
} from "../controllers/breakController";
import { anyRoleGuard } from "../middleware/adminGuard";
import { BREAK_ADMIN_ROLES } from "../services/breakService";

const breakRoute = Router();
const jwt = passport.authenticate("jwt", { session: false });
const adminOnly = anyRoleGuard(...BREAK_ADMIN_ROLES);

// Employee side — the lock screen talks to these.
breakRoute.post("/start", jwt, start);
// Inactivity report → server decides whether it becomes an idle break.
breakRoute.post("/idle", jwt, idle);
breakRoute.post("/request-unlock-otp", jwt, requestUnlockOtp);
breakRoute.post("/stop", jwt, stop);
breakRoute.get("/current", jwt, current);
breakRoute.get("/logs", jwt, logs);
breakRoute.get("/summary", jwt, summary);
// Optional SSE accelerator (token in query — EventSource can't set headers).
breakRoute.get("/stream", stream);

// Admin / HR side.
breakRoute.get("/open", jwt, adminOnly, openBreaks);
// Policy: which roles the feature applies to (+ master switch, threshold).
breakRoute.get("/policy", jwt, adminOnly, getPolicy);
breakRoute.put("/policy", jwt, adminOnly, putPolicy);
breakRoute.post("/:id/force-end", jwt, adminOnly, forceEnd);

export { breakRoute };
