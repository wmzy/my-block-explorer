import { logger } from 'hono/logger';
import pinoLogger from '../server/logger';

// Hono logging middleware
export const loggerMiddleware = logger((...rest) => {
  pinoLogger.info(rest.join(' '));
});
