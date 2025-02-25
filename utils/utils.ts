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
