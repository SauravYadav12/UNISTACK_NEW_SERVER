import { Schema, model, Document, Types } from "mongoose";

/**
 * Annual Form-16 PDF issued by HR per employee per financial year.
 *
 * Storage shape mirrors `SalarySlip`: one row per (user, fiscalYearStart),
 * unique compound index so the upload drawer's duplicate-guard has a
 * server-side authority. Employee fields are denormalised at upload
 * time so the row remains readable even if HR later deletes the user.
 *
 * `published` gates employee visibility. Until set, the doc is HR-only
 * (admin grid shows it as Draft).
 */

export interface Form16Doc extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  fiscalYearStart: number;       // 2024 → FY 2024–25
  fileUrl: string;
  originalFilename?: string;
  fileSizeBytes?: number;
  // Denormalised employee context, frozen at upload time. Keeps the
  // admin grid + employee view readable even after profile edits or
  // user deletion.
  employeeName: string;
  employeeId?: string;
  // Publish gate. Until true the doc is invisible to the employee.
  published: boolean;
  publishedAt?: Date;
  publishedBy?: Types.ObjectId;
  // Upload audit trail.
  uploadedAt: Date;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const form16Schema = new Schema<Form16Doc>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fiscalYearStart: { type: Number, required: true },
    fileUrl: { type: String, required: true, trim: true },
    originalFilename: { type: String, trim: true },
    fileSizeBytes: { type: Number },
    employeeName: { type: String, required: true, trim: true },
    employeeId: { type: String, trim: true },
    published: { type: Boolean, default: false, required: true },
    publishedAt: { type: Date },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: () => new Date(), required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// One row per (user, FY). Duplicate uploads must explicitly replace.
form16Schema.index({ user: 1, fiscalYearStart: 1 }, { unique: true });
// Powers the admin grid filter "show all rows for FY 202X".
form16Schema.index({ fiscalYearStart: 1, published: 1 });

export const Form16Model = model<Form16Doc>("Form16", form16Schema);
