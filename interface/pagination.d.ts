export interface PaginateResult<T> {
  next?: { page: number; limit: number };
  previous?: { page: number; limit: number };
  results?: T[];
  currentPage?: number;
  totalPages?: number;
}
