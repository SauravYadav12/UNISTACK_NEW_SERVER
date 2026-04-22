import mongoose, { Document } from "mongoose";
import { ProjectModel } from "./projectModel";
import { OrganizationModel } from "./organizationModel";
import {
  ITimesheet,
  ITimesheetEntry,
  ITimesheetScreenshot,
} from "../interface/modelInterfaces";

export interface TimesheetDoc
  extends Omit<
      ITimesheet,
      | "_id"
      | "projectRef"
      | "organizationRef"
      | "completedAt"
      | "createdAt"
      | "updatedAt"
    >,
    Document {
  _id: mongoose.Types.ObjectId;
  projectRef: mongoose.Types.ObjectId;
  organizationRef: mongoose.Types.ObjectId;
  // completedAt is a string on the JSON interface (for the wire) but a real
  // Date on the Mongoose doc.
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const entrySchema = new mongoose.Schema<ITimesheetEntry>(
  {
    date: { type: String, required: true },
    hours: { type: Number, required: true, default: 0, min: 0, max: 24 },
  },
  { _id: false }
);

const screenshotSchema = new mongoose.Schema<ITimesheetScreenshot>(
  {
    weekStart: { type: String, required: true },
    weekEnd: { type: String, required: true },
    weekLabel: { type: String },
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    sizeBytes: { type: Number },
    uploadedBy: { type: String },
    uploadedAt: { type: String, default: () => new Date().toISOString() },
  },
  { _id: true }
);

// Monthly timesheet. One doc per (project, periodMonth) holding every day of
// the month. Earlier revision was per-week; switched to monthly so the UI can
// show a proper calendar-style month picker and the approval unit matches.
const timesheetSchema = new mongoose.Schema<TimesheetDoc>(
  {
    projectRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ProjectModel,
      required: true,
    },
    projectId: { type: String, required: true },
    organizationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: OrganizationModel,
      required: true,
    },
    periodMonth: { type: String, required: true }, // YYYY-MM
    entries: {
      type: [entrySchema],
      required: true,
      validate: {
        validator: (arr: ITimesheetEntry[]) =>
          arr.length >= 28 && arr.length <= 31,
        message: "Timesheet entries must match the month's day count (28–31).",
      },
    },
    totalHours: { type: Number, required: true, default: 0, min: 0 },
    allFilled: { type: Boolean, required: true, default: false },
    // Explicit "I'm done editing this month" flag — separate from allFilled
    // so an admin can mark complete even with zero-hour days (after confirming
    // the warning). Reset to false any time the entries array changes.
    completed: { type: Boolean, required: true, default: false },
    completedAt: { type: Date },
    completedBy: { type: String },
    screenshots: { type: [screenshotSchema], default: [] },
    filledBy: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

timesheetSchema.index({ projectRef: 1, periodMonth: 1 }, { unique: true });

export const TimesheetModel = mongoose.model<TimesheetDoc>(
  "Timesheet",
  timesheetSchema
);
