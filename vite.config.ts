import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import path from 'path';
import type { Plugin } from 'vite';

// Custom plugin to integrate Hono API app
function honoApiPlugin(): Plugin {
  return {
    name: 'hono-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        // Handle CORS preflight in dev mode
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Requested-With',
          );
          res.setHeader('Access-Control-Max-Age', '86400');
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          // Dynamically import the API app to support HMR
          const { default: apiApp } = await import('./src/api-app');

          // Convert Node.js request to Hono request
          // Restore the full path including /api prefix
          const fullPath = '/api' + (req.url || '');
          const url = new URL(fullPath, `http://${req.headers.host}`);

          // Handle request body for POST/PUT/PATCH requests
          let body: string | undefined = undefined;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            body = await new Promise<string>((resolve, reject) => {
              let data = '';
              req.on('data', chunk => {
                data += chunk;
              });
              req.on('end', () => {
                resolve(data);
              });
              req.on('error', reject);
            });
          }

          const request = new Request(url.toString(), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: body,
          });

          // Get response from Hono app
          const response = await apiApp.fetch(request);

          // Convert Hono response to Node.js response
          res.statusCode = response.status;

          // Set CORS header for dev
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');

          // Set headers
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          // Send body
          const responseBody = await response.text();
          res.end(responseBody);
        } catch (error) {
          console.error('API Error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react({
      exclude: ['node_modules/**'],
    }),
    wyw({
      sourceMap: process.env.NODE_ENV !== 'production',
      displayName: process.env.NODE_ENV !== 'production',
      exclude: ['node_modules/**'],
      evaluate: false,
    }),
    honoApiPlugin(),
  ],
  root: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: './dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/'))
            return 'vendor';
          if (id.includes('node_modules/react-router')) return 'router';
          if (id.includes('node_modules/echarts')) return 'charts';
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: true,
    cors: {
      origin: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
    },
  },
  publicDir: path.resolve(__dirname, 'public'),
  ssr: {
    noExternal: ['hono'],
  },
});
