import mongoose, { Schema, Document, Types } from "mongoose";
import { InterviewModel } from "./interviewModel";
import { UserModel } from "./userModel";
import { IInterviewLog } from "../interface/modelInterfaces";

/**
 * Activity log for interview create / update / delete actions. Mirrors
 * `requirement.log.model.ts` exactly — same shape, same patterns — so
 * the client-side log UI can reuse the diff-renderer with a swapped
 * foreign-key field name (`interviewRef` instead of `requirementRef`).
 *
 * Writes happen from the client after a successful `createInterview` or
 * `updateInterview` request (same approach as requirements — the server
 * does NOT auto-write logs on every mutation, the client posts an
 * explicit log entry with the old + new payloads).
 */

export interface InterviewLogDoc
  extends Omit<
      IInterviewLog,
      "_id" | "interviewRef" | "userRef" | "createdAt" | "updatedAt"
    >,
    Document {
  _id: Types.ObjectId;
  interviewRef: Types.ObjectId;
  userRef: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InterviewLogSchema: Schema<InterviewLogDoc> = new Schema(
  {
    interviewRef: {
      type: Schema.Types.ObjectId,
      ref: InterviewModel,
      required: true,
      index: true,
    },
    operation: {
      type: String,
      enum: ["create", "update", "delete"],
      required: true,
    },
    userName: { type: String, required: true },
    userRef: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
      required: true,
    },
    newData: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

const InterviewLogModel = mongoose.model<InterviewLogDoc>(
  "InterviewLog",
  InterviewLogSchema,
);

export default InterviewLogModel;
