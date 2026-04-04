import { cors } from 'hono/cors';

// CORS middleware configuration
export const corsMiddleware = cors({
  origin: origin => {
    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      return origin ?? '*';
    }

    // Production: allow specific origins (GitHub Pages + local dev)
    const allowedOrigins = [
      'https://wmzy.github.io',
      'http://localhost:3000',
      'http://localhost:8201',
    ];

    return allowedOrigins.includes(origin ?? '') ? origin : allowedOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Response-Time', 'X-Data-Source', 'X-Chain-Id'],
  credentials: true,
  maxAge: 86400,
});
