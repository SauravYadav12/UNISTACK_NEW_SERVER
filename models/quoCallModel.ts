import mongoose, { Document, Schema } from "mongoose";

/**
 * One row per Quo call. Hydrated by the webhook ingest service on
 * `call.ringing` / `call.completed` / `call.recording.completed`
 * events. Keyed on `quoCallId` (unique) so re-delivered webhooks
 * upsert in place — Quo will retry until we ACK 2xx.
 *
 * Design decision: we DO NOT store the recording binary here. The
 * `hasRecording` bool + `recordingIds[]` are enough — the client hits
 * `/quo/calls/:id/recording` on demand and the server proxies to a
 * fresh Quo signed URL. See plan for the "why not re-host" reasoning.
 *
 * `summary` + `transcript` are populated by the AI webhooks
 * (`call.summary.completed`, `call.transcript.completed`) which are
 * eventually-consistent — they may arrive minutes after the call
 * ends, so both fields are optional.
 */

export interface QuoCallTranscriptSegment {
  identifier: string;
  content: string;
  start: number;
  end: number;
  userId?: string;
}

export interface QuoCallDoc extends Document {
  /** Quo's call id (e.g. "AC…") — unique per call. */
  quoCallId: string;
  /** Our local ref to the owned phone number the call went through. */
  phoneNumberId: mongoose.Types.ObjectId;
  /** Denormalised for quick filtering — matches QuoPhoneNumber.quoId. */
  quoPhoneNumberId: string;
  direction: "incoming" | "outgoing";
  /** Quo's call.status. `missed` / `no-answer` / `abandoned` are the
   *  triage-red cases the timeline highlights. */
  status: string;
  /** E.164 numbers of both sides. Always 2 items after `call.completed`. */
  participants: string[];
  initiatedBy?: string;
  answeredBy?: string;
  userId?: string;
  createdAt: Date;
  answeredAt?: Date;
  completedAt?: Date;
  /** Duration in seconds — filled on `call.completed`. */
  duration?: number;
  forwardedFrom?: string;
  forwardedTo?: string;
  aiHandled: boolean;
  hasRecording: boolean;
  hasVoicemail: boolean;
  /** Recording asset ids returned by Quo — used to look up the mp3 URL
   *  on demand via `GET /v1/call-recordings/{callId}`. */
  recordingIds: string[];
  /** AI-summary text (populated by `call.summary.completed` webhook). */
  summary?: string;
  /** AI transcript segments (populated by `call.transcript.completed`). */
  transcript?: QuoCallTranscriptSegment[];
  /** Last time any field on this doc changed (used by the poll delta). */
  updatedAt: Date;
}

const QuoCallSchema = new Schema<QuoCallDoc>(
  {
    quoCallId: { type: String, required: true, unique: true },
    phoneNumberId: {
      type: Schema.Types.ObjectId,
      ref: "QuoPhoneNumber",
      required: true,
    },
    quoPhoneNumberId: { type: String, required: true, index: true },
    direction: { type: String, enum: ["incoming", "outgoing"], required: true },
    status: { type: String, required: true },
    participants: { type: [String], default: [] },
    initiatedBy: { type: String },
    answeredBy: { type: String },
    userId: { type: String },
    answeredAt: { type: Date },
    completedAt: { type: Date },
    duration: { type: Number },
    forwardedFrom: { type: String },
    forwardedTo: { type: String },
    aiHandled: { type: Boolean, default: false },
    hasRecording: { type: Boolean, default: false },
    hasVoicemail: { type: Boolean, default: false },
    recordingIds: { type: [String], default: [] },
    summary: { type: String },
    transcript: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Grid / timeline read pattern: "give me the N most-recent events on
// this number". Compound index on phoneNumberId + createdAt covers it.
QuoCallSchema.index({ phoneNumberId: 1, createdAt: -1 });
// Counterparty search pattern: "find every call involving +1 415…".
QuoCallSchema.index({ participants: 1 });

export const QuoCallModel = mongoose.model<QuoCallDoc>(
  "QuoCall",
  QuoCallSchema,
);
