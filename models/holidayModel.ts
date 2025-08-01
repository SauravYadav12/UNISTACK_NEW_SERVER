import mongoose from "mongoose";
import { dateValidator, HalfDayType } from "./leaveModel";

const holiday = new mongoose.Schema(
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
        return (this as any)?.isHalfDay;
      },
    },
  },
  {
    timestamps: true,
  }
);

export const HolidayModel = mongoose.model("Holiday", holiday);

export const checkHolidayOverlap = async (
  fromDate: string | undefined,
  toDate: string | undefined,
  excludeId?: string
): Promise<boolean> => {
  if (!fromDate && !toDate) {
    throw new Error("At least one date (fromDate or toDate) is required");
  }

  const query: any = {
    $or: [],
  };

  if (fromDate && toDate) {
    if (new Date(fromDate) > new Date(toDate)) {
      throw new Error("fromDate cannot be after toDate");
    }

    query.$or.push(
      {
        fromDate: { $lte: toDate },
        toDate: { $gte: fromDate },
      },
      {
        fromDate: { $gte: fromDate },
        toDate: { $lte: toDate },
      }
    );
  } else if (fromDate) {
    query.$or.push({
      fromDate: { $lte: fromDate },
      toDate: { $gte: fromDate },
    });
  } else if (toDate) {
    query.$or.push({
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
