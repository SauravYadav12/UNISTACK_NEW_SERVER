import mongoose, { Document, Schema } from "mongoose";

/**
 * Authoritative list of Quo phone numbers owned by the org, plus the
 * user-editable `label` a super-admin can pin to each number
 * ("+1 415 555 1234 → Sales · Ravi"). Populated + refreshed by the
 * `POST /quo/phone-numbers/sync` endpoint which calls Quo's
 * `GET /v1/phone-numbers`. `label` and `syncedAt` are always preserved
 * across syncs (upsert on `quoId`) so we never wipe an admin's naming.
 */
export interface QuoPhoneNumberDoc extends Document {
  /** Quo's own id (e.g. "PN…") — unique across the account. */
  quoId: string;
  /** E.164 canonical number, e.g. "+14155551234". */
  e164: string;
  /** User-assigned nickname. Optional — displayed when set. */
  label?: string;
  /** Optional Quo user id this number belongs to (from listPhoneNumbers). */
  assignedUserId?: string;
  /** Last time the number list was refreshed from Quo. */
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuoPhoneNumberSchema = new Schema<QuoPhoneNumberDoc>(
  {
    quoId: { type: String, required: true, unique: true },
    e164: { type: String, required: true, unique: true, trim: true },
    label: { type: String, trim: true },
    assignedUserId: { type: String, trim: true },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

export const QuoPhoneNumberModel = mongoose.model<QuoPhoneNumberDoc>(
  "QuoPhoneNumber",
  QuoPhoneNumberSchema,
);
