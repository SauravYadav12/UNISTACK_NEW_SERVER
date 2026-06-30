import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  addTimesheetScreenshot,
  deleteTimesheet,
  getAllTimesheets,
  getTimesheetByMonth,
  markTimesheetComplete,
  removeTimesheetScreenshot,
  setTimesheetScreenshotSlots,
  upsertTimesheet,
} from "../controllers/timesheetController";

const timesheetRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const writers = anyRoleGuard(
  UserRole.SuperAdmin,
  UserRole.Admin,
  UserRole.ProjectCoordinator
);

timesheetRoute.get("/get-timesheets", jwt, getAllTimesheets);
timesheetRoute.get("/by-month", jwt, getTimesheetByMonth);
timesheetRoute.post("/upsert", jwt, writers, upsertTimesheet);
timesheetRoute.post("/mark-complete", jwt, writers, markTimesheetComplete);
timesheetRoute.post("/:id/screenshots", jwt, writers, addTimesheetScreenshot);
timesheetRoute.put(
  "/:id/screenshot-slots",
  jwt,
  writers,
  setTimesheetScreenshotSlots
);
timesheetRoute.delete(
  "/:id/screenshots/:shotId",
  jwt,
  writers,
  removeTimesheetScreenshot
);
timesheetRoute.delete("/:id", jwt, writers, deleteTimesheet);

export { timesheetRoute };
