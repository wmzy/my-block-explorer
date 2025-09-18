import { Context } from "hono";
import type { ErrorResponse } from "../types/index";

/**
 * 错误处理中间件
 */
export const errorHandler = async (err: Error, c: Context) => {
  console.error("API Error:", err);

  // 根据错误类型返回不同的状态码和消息
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Internal server error";

  if (err.message.includes("not found") || err.message.includes("Not found")) {
    status = 404;
    code = "NOT_FOUND";
    message = "Resource not found";
  } else if (
    err.message.includes("validation") ||
    err.message.includes("invalid")
  ) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = err.message;
  } else if (err.message.includes("timeout")) {
    status = 408;
    code = "REQUEST_TIMEOUT";
    message = "Request timeout";
  } else if (err.message.includes("rate limit")) {
    status = 429;
    code = "RATE_LIMIT_EXCEEDED";
    message = "Rate limit exceeded";
  }

  const errorResponse: ErrorResponse = {
    code,
    message,
    details: process.env.NODE_ENV === "development" ? err.stack : undefined,
  };

  // 设置响应头
  c.header("X-Error-Code", code);
  c.header("X-Error-Time", new Date().toISOString());

  return con(errorResponse, status);
};
