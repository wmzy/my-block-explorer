// BigInt-safe JSON replacer leaf: viem RPC payloads carry bigint
// quantities, and JSON.stringify throws on them unless the replacer
// converts them first. Import-free on purpose — the MCP layer stays
// pino-free and any graph (browser, server, mcp) can adopt it.

/** JSON.stringify replacer: bigint → decimal string, everything else verbatim. */
export function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
