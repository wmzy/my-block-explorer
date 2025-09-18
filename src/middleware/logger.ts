import { logger } from 'hono/logger';
import pino from 'pino';

// 创建pino日志实例
export const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

// Hono日志中间件
export const loggerMiddleware = logger((message, ...rest) => {
  pinoLogger.info(message, ...rest);
});
