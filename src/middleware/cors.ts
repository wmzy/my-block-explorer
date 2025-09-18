import { cors } from 'hono/cors';

// CORS中间件配置
export const corsMiddleware = cors({
  origin: (origin) => {
    // 开发环境允许所有来源
    if (process.env.NODE_ENV === 'development') {
      return origin || '*';
    }
    
    // 生产环境只允许特定来源
    const allowedOrigins = [
      'https://your-domain.com',
      'https://localhost:3000',
      'http://localhost:3000',
    ];
    
    return allowedOrigins.includes(origin || '') ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Response-Time', 'X-Data-Source', 'X-Chain-Id'],
  credentials: true,
  maxAge: 86400, // 24小时
});
