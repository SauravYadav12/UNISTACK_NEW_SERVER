import { Router } from "express";
import passport from "passport";
import {
  start,
  requestUnlockOtp,
  stop,
  current,
  logs,
  summary,
  openBreaks,
  forceEnd,
  stream,
} from "../controllers/breakController";
import { anyRoleGuard } from "../middleware/adminGuard";
import { BREAK_ADMIN_ROLES } from "../services/breakService";

const breakRoute = Router();
const jwt = passport.authenticate("jwt", { session: false });
const adminOnly = anyRoleGuard(...BREAK_ADMIN_ROLES);

// Employee side — the lock screen talks to these.
breakRoute.post("/start", jwt, start);
breakRoute.post("/request-unlock-otp", jwt, requestUnlockOtp);
breakRoute.post("/stop", jwt, stop);
breakRoute.get("/current", jwt, current);
breakRoute.get("/logs", jwt, logs);
breakRoute.get("/summary", jwt, summary);
// Optional SSE accelerator (token in query — EventSource can't set headers).
breakRoute.get("/stream", stream);

// Admin / HR side.
breakRoute.get("/open", jwt, adminOnly, openBreaks);
breakRoute.post("/:id/force-end", jwt, adminOnly, forceEnd);

export { breakRoute };
