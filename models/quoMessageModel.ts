import mongoose, { Document, Schema } from "mongoose";

/**
 * One row per SMS. Hydrated by the webhook ingest service on
 * `message.received` and `message.delivered` events. Keyed on
 * `quoMessageId` (unique) so Quo retries upsert in place.
 *
 * `conversationId` is the join key we use to collapse consecutive
 * messages from the same counterparty into a single "conversation
 * card" in the timeline UI.
 */
export interface QuoMessageDoc extends Document {
  quoMessageId: string;
  phoneNumberId: mongoose.Types.ObjectId;
  quoPhoneNumberId: string;
  conversationId: string;
  direction: "incoming" | "outgoing";
  /** E.164 sender. For outgoing, this is our owned number. */
  from: string;
  /** E.164 recipients. Group MMS is possible; usually 1 entry. */
  to: string[];
  text: string;
  status: string;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QuoMessageSchema = new Schema<QuoMessageDoc>(
  {
    quoMessageId: { type: String, required: true, unique: true },
    phoneNumberId: {
      type: Schema.Types.ObjectId,
      ref: "QuoPhoneNumber",
      required: true,
    },
    quoPhoneNumberId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true },
    direction: { type: String, enum: ["incoming", "outgoing"], required: true },
    from: { type: String, required: true },
    to: { type: [String], default: [] },
    text: { type: String, default: "" },
    status: { type: String, required: true },
    userId: { type: String },
  },
  { timestamps: true },
);

// Grid read: "N most recent messages on this number".
QuoMessageSchema.index({ phoneNumberId: 1, createdAt: -1 });
// Thread read: "all messages in this conversation, oldest first".
QuoMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const QuoMessageModel = mongoose.model<QuoMessageDoc>(
  "QuoMessage",
  QuoMessageSchema,
);
