import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  splitting: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node\n',
  },
  external: [
    '@duckdb/node-api',
    '@duckdb/node-bindings-darwin-arm64',
    '@duckdb/node-bindings-linux-x64',
    '@duckdb/node-bindings-darwin-x64',
    '@duckdb/node-bindings-win32-x64',
    'drizzle-orm',
    'hono',
    'undici',
  ],
});
