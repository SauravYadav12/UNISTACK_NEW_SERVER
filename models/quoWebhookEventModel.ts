import mongoose, { Document, Schema } from "mongoose";

/**
 * Idempotency guard for Quo webhooks. Quo retries webhook delivery on
 * any non-2xx (and even sometimes after we've ACKed) — every incoming
 * event carries a unique `id`, and we short-circuit if we've already
 * ingested it.
 *
 * TTL index (30 days) so the collection stays tiny — the guard only
 * matters within Quo's own retry window, which is far shorter than
 * that. Same shape as `models/jobSearchCacheModel.ts`.
 */
export interface QuoWebhookEventDoc extends Document {
  /** Quo's event id — unique per webhook delivery. */
  eventId: string;
  kind: string;
  receivedAt: Date;
}

const QuoWebhookEventSchema = new Schema<QuoWebhookEventDoc>(
  {
    eventId: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

// TTL — Mongo purges rows 30 days after receivedAt.
QuoWebhookEventSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

export const QuoWebhookEventModel = mongoose.model<QuoWebhookEventDoc>(
  "QuoWebhookEvent",
  QuoWebhookEventSchema,
);
