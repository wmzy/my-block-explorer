// API响应类型定义

// 成功响应：直接返回数据
export type DataResponse<T> = T;

// 列表响应：包含数据和分页信息
export type ListResponse<T> = {
  data: T[];
  pagination: PaginationInfo;
};

// 错误响应：简化结构
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

// API请求参数类型
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
