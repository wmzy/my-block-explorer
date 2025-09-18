import { Context, Next } from 'hono';

/**
 * 请求计时中间件
 * 计算请求处理时间并添加到响应头
 */
export const timingMiddleware = async (c: Context, next: Next) => {
  const start = Date.now();
  
  await next();
  
  const duration = Date.now() - start;
  c.header('X-Response-Time', `${duration}ms`);
};
