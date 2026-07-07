import mongoose, { Document, Schema, Types } from "mongoose";
import { ChessLeadModel } from "./chessLeadModel";
import { UserModel } from "./userModel";
import { IChessLeadLog } from "../interface/modelInterfaces";

export interface ChessLeadLogDoc
  extends Omit<
      IChessLeadLog,
      "_id" | "leadRef" | "userRef" | "createdAt" | "updatedAt"
    >,
    Document {
  _id: Types.ObjectId;
  leadRef: Types.ObjectId;
  userRef: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ChessLeadLogSchema = new Schema<ChessLeadLogDoc>(
  {
    leadRef: {
      type: Schema.Types.ObjectId,
      ref: ChessLeadModel,
      required: true,
      index: true,
    },
    leadId: { type: String, required: true, index: true },
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
    oldData: { type: Schema.Types.Mixed },
    newData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

const ChessLeadLogModel = mongoose.model<ChessLeadLogDoc>(
  "ChessLeadLog",
  ChessLeadLogSchema,
);

export default ChessLeadLogModel;
