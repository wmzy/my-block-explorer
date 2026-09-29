// MCP server assembly: one McpServer instance wired with the explorer's
// read-only tools. Transport-agnostic on purpose — the stdio CLI
// (src/mcp/cli.ts) connects a StdioServerTransport, while tests drive the
// exact same server over an InMemoryTransport pair, so tool behavior is
// verified through the real protocol path.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appVersion } from '@/version';
import { ExplorerApi } from './rest';
import { RpcGateway, type RpcReader } from './rpc';
import { registerExplorerTools } from './tools';

/** Same default the service-discovery gate lands on for the web UI. */
export const DEFAULT_MCP_API_BASE = 'http://127.0.0.1:8201';

const INSTRUCTIONS = `A local multi-chain block explorer.

Two data planes, mirrored from the explorer's architecture:
- LIVE chain data (blocks, transactions, balances, storage, read-only contract calls) is read directly from RPC and works even without the backend;
- PERSISTENT data (verified contract sources/ABIs, indexed events, discovered address transactions, search) is served by the local explorer backend over its REST API — if it is not running, those tools explain how to start it.

Contracts of honesty you should respect when relaying results:
- address transaction lists are heuristic discoveries; the coverage field says how complete they are;
- events cover only the block ranges configured in the explorer;
- integer quantities (wei, raw block fields) are decimal strings, not JSON numbers.`;

export type CreateExplorerMcpServerOptions = {
  /** Backend REST origin; default http://127.0.0.1:8201 (EXPLORER_API_URL overrides in the CLI). */
  apiBase?: string;
  /** Test seam: inject a stubbed REST client / RPC reader. */
  api?: ExplorerApi;
  rpc?: RpcReader;
};

export function createExplorerMcpServer(options: CreateExplorerMcpServerOptions = {}): McpServer {
  const api = options.api ?? new ExplorerApi(options.apiBase ?? DEFAULT_MCP_API_BASE);
  const rpc = options.rpc ?? new RpcGateway(api);
  const server = new McpServer(
    { name: 'my-block-explorer', version: appVersion() },
    { instructions: INSTRUCTIONS },
  );
  registerExplorerTools(server, { api, rpc });
  return server;
}
