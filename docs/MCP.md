# MCP Server

The explorer ships a [Model Context Protocol](https://modelcontextprotocol.org) server
(`my-block-explorer-mcp`) that lets AI assistants — Claude Desktop, Cursor,
VS Code, agent harnesses — read chain data and the explorer's indexed data
through the same honesty contracts the web UI enforces.

## Architecture

The MCP server is a **separate process** from the backend, on purpose: the
backend owns the DuckDB single-writer lock, and a second in-process consumer
would fight over `data/blockchain.db`. It therefore has two data planes,
mirroring the explorer's data-separation architecture:

| Plane | Source | Works backend-less? |
|---|---|---|
| Live chain data (blocks, transactions, balances, storage, read-only contract calls) | direct RPC (viem) | yes — falls back to viem default RPCs |
| Persistent data (verified sources/ABIs, indexed events, discovered address transactions, search) | backend REST API | no — tools explain how to start it |

RPC URL precedence mirrors the browser: backend-stored user rpc-config →
user-registered custom chain → viem default. Both are fetched from the open
REST endpoints (`/api/rpc-configs`, `/api/chains/custom`) and cached ~60s.

## Running

```bash
# published package
npx my-block-explorer-mcp

# repo dev
pnpm mcp

# built bundle
node dist/server/mcp.js
```

Environment:

- `EXPLORER_API_URL` — backend REST origin (default `http://127.0.0.1:8201`)

The server speaks MCP over **stdio**. stdout is the protocol channel;
diagnostics go to stderr.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "block-explorer": {
      "command": "npx",
      "args": ["my-block-explorer-mcp"],
      "env": { "EXPLORER_API_URL": "http://127.0.0.1:8201" }
    }
  }
}
```

### Cursor / VS Code

`.cursor/mcp.json` (Cursor) or `.vscode/mcp.json` (VS Code, "servers" block):

```json
{
  "servers": {
    "block-explorer": {
      "command": "npx",
      "args": ["my-block-explorer-mcp"],
      "env": { "EXPLORER_API_URL": "http://127.0.0.1:8201" }
    }
  }
}
```

## Tools

| Tool | Plane | Notes |
|---|---|---|
| `health` | REST | backend version/flags |
| `list_chains` | both | popular built-ins + registered custom chains |
| `search` | REST | address / hash / block / ENS / free text |
| `get_block` | RPC | by number, hash or tag; optional full transactions |
| `get_transaction` | RPC | transaction + receipt (receipt `null` while pending) |
| `get_address_overview` | RPC | balance (wei string), nonce, EOA / contract / EIP-7702 classification |
| `get_contract` | REST | verified source, parsed ABI, proxy + creation info |
| `read_contract` | RPC | view/pure call with a human-readable signature; JSON args (ints as strings keep precision) |
| `get_events` | REST | indexed ranges ONLY — empty results say so |
| `get_indexing_status` | REST | configured ranges + statistics, per-section degrade |
| `get_address_transactions` | REST | heuristic discovery; `coverage` travels verbatim |
| `get_storage_at` | RPC | one raw slot; decimal or hex slot forms |

All tools are **read-only** (`readOnlyHint`) — the mutating/admin surface
(labels, watch, SQL console, event-range writes) deliberately stays on the
web UI. Backend rate-limit buckets apply as for any REST client (e.g. search
30/min·10, address-transactions 10/min·3).

## Honesty contracts carried into tool results

- **Integer quantities are decimal strings** (wei, raw RPC fields) — never
  JSON numbers, so precision survives every hop.
- **Address transaction lists are discoveries** — `coverage`/`reason` are
  relayed verbatim; only a finished genesis-anchored deep scan reports
  `complete`.
- **Events cover only configured ranges** — an empty `get_events` result
  carries a note that absence is not proof the contract never emitted events.
- **Backend-down is a state, not an error to hide** — REST tools return
  `isError` results telling the caller how to start the backend; RPC tools
  keep working.
