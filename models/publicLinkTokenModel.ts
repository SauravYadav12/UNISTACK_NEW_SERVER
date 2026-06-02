/**
 * Public-link token — a one-shot or time-bound credential that lets an
 * unauthenticated visitor (typically an onboarding candidate) reach a
 * specific surface of the portal: their onboarding form, their offer
 * letter to sign.
 *
 * Tokens are crypto-random 32-byte hex strings carried in the URL
 * (`/onboarding/<token>` or `/offer/<token>`). They're stored here
 * rather than encoded in a JWT so we can:
 *   - revoke them (admin "resend link" creates a new one + sets
 *     `revokedAt` on the old one),
 *   - track single-use consumption (`consumedAt` flips on the
 *     terminal action: form submit or offer sign),
 *   - expire deterministically (60-day default via TTL index).
 *
 * The shape is intentionally generic — every new public surface
 * (e.g. future client-portal share links) can reuse this model by
 * picking a new `purpose` enum value rather than introducing another
 * token table.
 */

import mongoose, { Document, Schema, Types } from "mongoose";

export type PublicLinkPurpose = "onboarding-form" | "offer-letter";

export const PUBLIC_LINK_PURPOSES: PublicLinkPurpose[] = [
  "onboarding-form",
  "offer-letter",
];

export interface PublicLinkTokenDoc extends Document {
  _id: Types.ObjectId;
  token: string;
  purpose: PublicLinkPurpose;
  candidateRef: Types.ObjectId;
  expiresAt: Date;
  consumedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const publicLinkTokenSchema = new Schema<PublicLinkTokenDoc>(
  {
    token: { type: String, required: true, unique: true, index: true },
    purpose: {
      type: String,
      required: true,
      enum: PUBLIC_LINK_PURPOSES,
    },
    candidateRef: {
      type: Schema.Types.ObjectId,
      ref: "OnboardingCandidate",
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

// TTL: Mongo removes expired tokens within ~60s of expiresAt elapsing.
// Same pattern as JobSearchCacheModel.
publicLinkTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PublicLinkTokenModel = mongoose.model<PublicLinkTokenDoc>(
  "PublicLinkToken",
  publicLinkTokenSchema,
);
