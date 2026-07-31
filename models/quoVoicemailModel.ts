import mongoose, { Document, Schema } from "mongoose";

/**
 * One row per voicemail. Voicemails are 1:1 with a QuoCall (a caller
 * leaves a message when we don't answer), so the join key IS the call
 * id. Populated when Quo fires the voicemail webhook — usually a few
 * seconds after the call ends.
 *
 * `transcript` may be absent when `status === "in-progress"`. The UI
 * surfaces "transcript pending" and re-fetches on the next 30 s poll.
 */
export interface QuoVoicemailDoc extends Document {
  quoCallId: string;
  phoneNumberId: mongoose.Types.ObjectId;
  quoPhoneNumberId: string;
  from: string;
  to: string;
  status: "in-progress" | "completed";
  transcript?: string;
  durationSec?: number;
  createdAt: Date;
  updatedAt: Date;
}

const QuoVoicemailSchema = new Schema<QuoVoicemailDoc>(
  {
    quoCallId: { type: String, required: true, unique: true },
    phoneNumberId: {
      type: Schema.Types.ObjectId,
      ref: "QuoPhoneNumber",
      required: true,
    },
    quoPhoneNumberId: { type: String, required: true, index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    status: {
      type: String,
      enum: ["in-progress", "completed"],
      required: true,
    },
    transcript: { type: String },
    durationSec: { type: Number },
  },
  { timestamps: true },
);

QuoVoicemailSchema.index({ phoneNumberId: 1, createdAt: -1 });

export const QuoVoicemailModel = mongoose.model<QuoVoicemailDoc>(
  "QuoVoicemail",
  QuoVoicemailSchema,
);
