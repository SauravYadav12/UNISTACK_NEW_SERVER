import mongoose, { Document, FilterQuery } from "mongoose";
import { dateValidator, HalfDayType } from "./leaveModel";
import { IHoliday } from "../interface/modelInterfaces";

export interface HolidayDoc
  extends Omit<IHoliday, "_id" | "createdAt" | "updatedAt">, Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const holiday = new mongoose.Schema<HolidayDoc>(
  {
    name: String,
    description: String,
    fromDate: {
      type: String,
      required: true,
      validate: dateValidator,
    },
    toDate: {
      type: String,
      required: true,
      validate: dateValidator,
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
    halfDayType: {
      type: String,
      enum: Object.values(HalfDayType),
      required: function () {
        if ("isHalfDay" in this) {
          return this?.isHalfDay;
        }
        return false;
      },
    },
  },
  {
    timestamps: true,
  },
);

export const HolidayModel = mongoose.model<HolidayDoc>("Holiday", holiday);

export const checkHolidayOverlap = async (
  fromDate: string | undefined,
  toDate: string | undefined,
  excludeId?: string,
): Promise<boolean> => {
  if (!fromDate && !toDate) {
    throw new Error("At least one date (fromDate or toDate) is required");
  }

  const query: FilterQuery<HolidayDoc> = {
    $or: [],
  };

  if (fromDate && toDate) {
    if (new Date(fromDate) > new Date(toDate)) {
      throw new Error("fromDate cannot be after toDate");
    }

    query.$or?.push(
      {
        fromDate: { $lte: toDate },
        toDate: { $gte: fromDate },
      },
      {
        fromDate: { $gte: fromDate },
        toDate: { $lte: toDate },
      },
    );
  } else if (fromDate) {
    query.$or?.push({
      fromDate: { $lte: fromDate },
      toDate: { $gte: fromDate },
    });
  } else if (toDate) {
    query.$or?.push({
      fromDate: { $lte: toDate },
      toDate: { $gte: toDate },
    });
  }

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existingHolidays = await HolidayModel.find(query);
  return existingHolidays.length > 0;
};
