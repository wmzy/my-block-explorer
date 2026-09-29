import { defineConfig } from 'tsup';

export default defineConfig({
  // Object keys keep the MCP CLI at dist/server/mcp.js — a plain path
  // entry would collide with src/cli.ts on the basename.
  entry: {
    server: 'src/server.ts',
    cli: 'src/cli.ts',
    mcp: 'src/mcp/cli.ts',
  },
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node26',
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
