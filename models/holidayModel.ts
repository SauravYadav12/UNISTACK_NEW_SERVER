import mongoose, { Document, FilterQuery } from "mongoose";
import { dateValidator, HalfDayType } from "./leaveModel";
import { IHoliday } from "../interface/modelInterfaces";

export enum HolidayCountry {
  IN = "IN",
  US = "US",
  ALL = "ALL",
}

export enum HolidaySource {
  Manual = "manual",
  System = "system",
}

export interface HolidayDoc
  extends Omit<IHoliday, "_id" | "createdAt" | "updatedAt" | "noticeSentAt">, Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  noticeSentAt?: Date;
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
    country: {
      type: String,
      enum: Object.values(HolidayCountry),
      default: HolidayCountry.ALL,
    },
    source: {
      type: String,
      enum: Object.values(HolidaySource),
      default: HolidaySource.Manual,
    },
    externalId: { type: String },
    // Set by the holiday-notice scheduler so we never double-send the
    // heads-up email for the same holiday.
    noticeSentAt: { type: Date },
    noticeSentTo: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

holiday.index({ country: 1, fromDate: 1 });
holiday.index({ externalId: 1, country: 1 }, { unique: true, sparse: true });

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
