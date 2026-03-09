import { Router } from "express";
import passport from "passport";
import {
  updateAttendance,
  getAttendanceList,
  markAttendance,
  deleteAttendance,
} from "../controllers/attendanceController";

const attendanceRoute = Router();

attendanceRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getAttendanceList
);

attendanceRoute.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  markAttendance
);

attendanceRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateAttendance
);

attendanceRoute.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteAttendance
);

export { attendanceRoute };
