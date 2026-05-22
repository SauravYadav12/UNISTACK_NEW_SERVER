import mongoose, { Document, Schema } from "mongoose";

/**
 * Cache for upstream job-board search responses.
 *
 * Why this exists
 * ───────────────
 * The JSearch free tier on RapidAPI gives us only ~150–200 calls a month.
 * Without a shared cache, every marketer who searches "React Developer
 * Remote (US)" burns one of those calls — even if a teammate ran the same
 * search ten minutes ago. With this cache, identical queries across the
 * whole org collapse onto one upstream call for the lifetime of a row
 * (default: 6 hours).
 *
 * Why Mongo and not Redis
 * ───────────────────────
 * No new infra, no new cloud cost line item. The existing Mongoose
 * connection handles ~50 small rows at steady state, with the `expiresAt`
 * TTL index letting Mongo auto-purge stale entries (no cleanup cron).
 */

export interface JobSearchCacheDoc extends Document {
  /** sha256 of the normalized query — see `services/jobSearchCache.ts`. */
  cacheKey: string;
  /** Echoed back for debugging and audit-log readability. */
  query: string;
  location: string;
  filters: Record<string, unknown>;
  /** The full normalized response payload returned to the client. */
  payload: Record<string, unknown>;
  fetchedAt: Date;
  /** TTL index target — Mongo deletes the row once this is in the past. */
  expiresAt: Date;
}

const JobSearchCacheSchema = new Schema<JobSearchCacheDoc>(
  {
    cacheKey: { type: String, required: true, unique: true },
    query: { type: String, required: true },
    location: { type: String, default: "" },
    filters: { type: Schema.Types.Mixed, default: {} },
    payload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);

// TTL index — Mongo's background monitor purges expired rows roughly once
// a minute. `expireAfterSeconds: 0` means "delete as soon as `expiresAt`
// is in the past".
JobSearchCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const JobSearchCacheModel = mongoose.model<JobSearchCacheDoc>(
  "JobSearchCache",
  JobSearchCacheSchema,
);
