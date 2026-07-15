import mongoose, { Document } from "mongoose";

/**
 * Cache of AI-derived canonical forms for text values that appear in
 * the Employee Pulse trend chart. Merges seniority + spelling variants
 * (e.g. "Senior React Developer", "Sr React Dev", "Lead React Engineer"
 * → "React Developer") so the chart shows one line per real position
 * type instead of a line per phrasing.
 *
 * `raw` is the trimmed lower-cased input; `canonical` is what the chart
 * displays. `groupType` scopes the mapping (a job title vs a tech name
 * may collapse differently).
 */
export interface JobTitleCanonicalDoc extends Document {
  raw: string;
  canonical: string;
  groupType: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<JobTitleCanonicalDoc>(
  {
    raw: { type: String, required: true, lowercase: true, trim: true },
    canonical: { type: String, required: true, trim: true },
    groupType: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

schema.index({ raw: 1, groupType: 1 }, { unique: true });

export const JobTitleCanonicalModel = mongoose.model<JobTitleCanonicalDoc>(
  "JobTitleCanonical",
  schema,
);
