import pino from 'pino';

const MAX_ERROR_LENGTH = 500;

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  serializers: {
    err: (err: Error & { params?: unknown[] }) => {
      const message = err.message ?? '';
      const truncated =
        message.length > MAX_ERROR_LENGTH
          ? message.slice(0, MAX_ERROR_LENGTH) + '...[truncated]'
          : message;
      return {
        ...err,
        message: truncated,
        params: err.params ? `[${err.params.length} values truncated]` : undefined,
      };
    },
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export const createLogger = (module: string) => rootLogger.child({ module });

export default rootLogger;
