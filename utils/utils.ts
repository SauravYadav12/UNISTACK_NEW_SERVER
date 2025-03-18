import { Model } from "mongoose";
import { myDate } from "./dateUtil";

export const handleDateQuery = (query: any) => {
  const { fromDate, toDate } = query;

  if (fromDate || toDate) {
    const { from, to } = myDate(fromDate, toDate);
    query.createdAt = {
      $gte: from,
      $lte: to,
    };
    delete query.fromDate;
    delete query.toDate;
  }
  return { ...query };
};

export const handlePaginationQuery = (query: any) => {
  query = handleDateQuery(query);
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 100;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  delete query.page;
  delete query.limit;
  return { query, page, limit, startIndex, endIndex };
};

export const sequenceId = async (
  model: Model<any, {}, {}>,
  field: string,
  label: string = ""
) => {
  const lastDoc = await model.findOne({}, {}, { sort: { createdAt: -1 } });
  let count = 1;
  if (lastDoc && lastDoc[field]) {
    count = parseInt(lastDoc[field].split("-")[1]) + 1 || 1;
  }
  const i = count < 10 ? "0" + count : count;
  return `${label}-${i}`;
};
