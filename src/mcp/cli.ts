// MCP stdio entry point — `my-block-explorer-mcp` (package bin). The
// shebang comes from the tsup banner, like every dist entry here.
//
// Speaks Model Context Protocol over stdin/stdout for AI assistants
// (Claude Desktop, Cursor, VS Code, agent harnesses). IMPORTANT: stdout
// IS the protocol channel — nothing may ever write to stdout except the
// transport, so all diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_MCP_API_BASE, createExplorerMcpServer } from './server';

function stderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function main(): Promise<void> {
  const apiBase = (process.env.EXPLORER_API_URL ?? DEFAULT_MCP_API_BASE).trim();
  try {
    const parsed = new URL(apiBase);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http(s)');
  } catch {
    stderr(`my-block-explorer-mcp: EXPLORER_API_URL must be an http(s) URL, got "${apiBase}"`);
    process.exit(1);
  }

  const server = createExplorerMcpServer({ apiBase });
  await server.connect(new StdioServerTransport());
  stderr(`my-block-explorer-mcp ready — backend API ${apiBase} (set EXPLORER_API_URL to change)`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    stderr(`my-block-explorer-mcp: ${signal}, closing`);
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch(error => {
  stderr(`my-block-explorer-mcp: fatal — ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
