import mongoose, { Document } from "mongoose";

/**
 * Generic atomic counter. Used by {@link monthlySequenceId} to avoid the
 * race conditions inherent in "sort by createdAt, parse last id" patterns.
 *
 * One row per logical counter, keyed by `{ scope, key }`. For invoices that's
 * `{ scope: 'invoice', key: '{ORGSHORTCODE}-YYYYMM' }`.
 */
export interface CounterDoc extends Document {
  _id: mongoose.Types.ObjectId;
  scope: string;
  key: string;
  seq: number;
}

const counterSchema = new mongoose.Schema<CounterDoc>(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

counterSchema.index({ scope: 1, key: 1 }, { unique: true });

export const CounterModel = mongoose.model<CounterDoc>(
  "Counter",
  counterSchema
);
