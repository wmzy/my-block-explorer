// API response type definitions

// Success response: data returned directly
export type DataResponse<T> = T;

// List response: data plus pagination info
export type ListResponse<T> = {
  data: T[];
  pagination: PaginationInfo;
};

// Error response: simplified shape
export type ErrorResponse = {
  code: string;
  message: string;
  details?: unknown;
};

export type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

// API request parameter types
export type ApiPaginationParams = {
  page?: number;
  limit?: number;
};

export type TimeRangeParams = {
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
};

export type BlockRangeParams = {
  fromBlock?: number;
  toBlock?: number;
};
