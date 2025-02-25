import { Collection, Model } from "mongoose";
import { handlePaginationQuery } from "./utils";

export const paginationInstance = async (
  reqQuery: any,
  collection: Collection | Model<any, {}, {}>
): Promise<PaginationInstance> => {
  const options = handlePaginationQuery(reqQuery);
  const { query, page, limit, startIndex, endIndex } = options;
  const totalDocuments: number = await (collection as any).countDocuments(
    query
  );
  const totalPages = Math.ceil(totalDocuments / limit);

  const instance: MyPaginationInstance = {
    totalDocuments,
    totalPages,
    currentPage: page,
  };

  if (endIndex < totalDocuments) {
    instance.next = {
      page: page + 1,
      limit: limit,
    };
  }

  if (startIndex > 0) {
    instance.previous = {
      page: page - 1,
      limit: limit,
    };
  }

  return { instance, options };
};

export interface PaginationInstance {
  instance: MyPaginationInstance;
  options: PaginationOptions;
}
export interface MyPaginationInstance {
  next?: { page: number; limit: number };
  previous?: { page: number; limit: number };
  currentPage?: number;
  totalPages?: number;
  totalDocuments?: number;
}
export interface PaginationOptions {
  query: any;
  page: number;
  limit: number;
  startIndex: number;
  endIndex: number;
}
export interface PaginationResult<T> extends MyPaginationInstance {
  results?: T[];
}
