import { logger } from 'hono/logger';
import pinoLogger from "../server/logger";

// Hono日志中间件
export const loggerMiddleware = logger((...rest) => {
  pinoLogger.info(rest.join(" "));
});
