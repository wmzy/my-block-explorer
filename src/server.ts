import { serve } from '@hono/node-server';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import apiApp from './api-app';
import { db } from './database/drizzle';

const PROXY_URL =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy;

if (PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  console.log(`🔄 Global proxy configured: ${PROXY_URL}`);
}

const port = parseInt(process.env.PORT ?? '8201');

console.log('🚀 Starting Block Explorer Server...');
console.log(`📍 Port: ${port}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);

const server = serve(
  {
    fetch: apiApp.fetch,
    port,
  },
  info => {
    console.log(`✅ Server is running on http://localhost:${info.port}`);
    console.log(`📖 API Info: http://localhost:${info.port}/api`);
    console.log(`🏥 Health Check: http://localhost:${info.port}/api/health`);

    console.log('');
    console.log('📋 Available endpoints:');
    console.log('  GET /api                - API information');
    console.log('  GET /api/health         - Health check');
    console.log('  GET /api/search?q={}    - Search functionality');
    console.log('  GET /api/stats/overview - Statistics');

    if (process.env.NODE_ENV === 'production') {
      console.log('  GET /                   - Frontend application');
    }
  },
);

const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    await (db.$client as any).end?.();
  } catch (error) {
    console.warn('Shutdown checkpoint failed:', error);
  }
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
