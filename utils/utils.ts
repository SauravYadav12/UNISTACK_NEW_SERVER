import { myDate } from "./dateUtil";

export const queryTransform = (query: any) => {
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
  return query;
};
