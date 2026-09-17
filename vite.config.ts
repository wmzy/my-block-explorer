import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import hazeCss from 'vite-plugin-haze-ui';
import path from 'path';
import type { Plugin } from 'vite';
// Relative import of a dependency-free module — safe for esbuild's config
// bundling (no @/ alias resolution needed; see cors-origins.ts header).
import { allowedCorsOriginList } from './src/middleware/cors-origins';

// Custom plugin to integrate Hono API app
function honoApiPlugin(): Plugin {
  return {
    name: 'hono-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        // CORS (including OPTIONS preflights) is NOT handled here: every
        // request, preflight included, goes through the Hono app, whose
        // corsMiddleware answers with the shared allowlist policy
        // (cors-origins.ts) — the same one governing server.cors below.
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

          // Convert Hono response to Node.js response. Headers come from the
          // Hono app only — its corsMiddleware decides Access-Control-*.
          res.statusCode = response.status;

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
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    // On-demand CSS collection: scans haze-ui named imports and injects the
    // matching CSS side-effect imports (mechanism: vite-plugin-haze-ui README).
    hazeCss(),
    react({
      exclude: ['node_modules/**'],
    }),
    wyw({
      sourceMap: process.env.NODE_ENV !== 'production',
      displayName: process.env.NODE_ENV !== 'production',
      exclude: ['node_modules/**'],
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
    // Dev-server CORS uses the SAME allowlist as the Hono API middleware
    // (single source of truth: src/middleware/cors-origins.ts — imported
    // relatively, dependency-free, so esbuild can inline it into this
    // config without @/ alias resolution). The previous `origin: true`
    // echoed ANY origin with credentials, which both exposed dev assets
    // cross-origin and approved preflights for cross-origin /api writes
    // ahead of the API's own gate.
    cors: {
      origin: allowedCorsOriginList(),
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token'],
      credentials: true,
    },
  },
  publicDir: path.resolve(__dirname, 'public'),
  ssr: {
    noExternal: ['hono'],
  },
});
