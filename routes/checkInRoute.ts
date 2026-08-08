import { Router } from "express";
import passport from "passport";
import {
  checkIn,
  checkOut,
  current,
  logs,
} from "../controllers/checkInController";

const checkInRoute = Router();
const jwt = passport.authenticate("jwt", { session: false });

// Start a working-hours session (also marks the day Present).
checkInRoute.post("/", jwt, checkIn);
// Close the current session. body: { source?: 'manual' | 'logout' }.
checkInRoute.post("/out", jwt, checkOut);
// The caller's currently-open session (+ server time for elapsed calc).
checkInRoute.get("/current", jwt, current);
// Day/week/month log. Super-admin sees everyone; others see only their own.
checkInRoute.get("/logs", jwt, logs);

export { checkInRoute };
