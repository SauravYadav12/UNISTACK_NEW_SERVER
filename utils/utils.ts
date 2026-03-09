import { Document, Model } from "mongoose";
import { myDate } from "./dateUtil";
import moment from "moment";

export const attendanceDateFormate = "YYYY/MM/DD";
export const stringDateFormate = attendanceDateFormate;

export const isFormateValid = (d: string) =>
  moment(d, attendanceDateFormate, true).isValid();

export const handleDateQuery = (
  query: Record<string, unknown>,
  fieldName = "createdAt",
) => {
  const { fromDate, toDate } = query;

  if (fromDate || toDate) {
    const { from, to } = myDate(fromDate, toDate);
    query[fieldName] = {
      $gte: from,
      $lte: to,
    };
    delete query.fromDate;
    delete query.toDate;
  }
  return { ...query };
};

export const handlePaginationQuery = (query: Record<string, unknown>) => {
  query = handleDateQuery(query);
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 100;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  delete query.page;
  delete query.limit;
  return { query, page, limit, startIndex, endIndex };
};

export const sequenceId = async <T extends Document>(
  model: Model<T>,
  field: string,
  label: string = "",
) => {
  const lastDoc =( await model.findOne({}, {}, { sort: { createdAt: -1 } })) as Record<string, unknown> | null;
  let count = 1;
  if (lastDoc && lastDoc[field] && typeof lastDoc[field] === "string") {
    count = parseInt(lastDoc[field].split("-")[1]) + 1 || 1;
  }
  const i = count < 10 ? "0" + count : count;
  return `${label}-${i}`;
};

export function handleAttendanceDateQueryParams(
  query: Record<string, unknown>,
) {
  const { fromDate, toDate } = query;
  if (
    (fromDate && !isFormateValid(fromDate as string)) ||
    (toDate && !isFormateValid(toDate as string))
  ) {
    return { error: "Date formate should be " + attendanceDateFormate };
  }
  if (fromDate || toDate) {
    const from = fromDate || moment().format(attendanceDateFormate);
    const to = toDate || moment().format(attendanceDateFormate);
    query.date = {
      $gte: from,
      $lte: to,
    };
    delete query.fromDate;
    delete query.toDate;
  }

  return { query };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
