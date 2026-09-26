// OpenAPI description of this backend's HTTP surface (PM-review P3): a
// machine-readable document served at GET /api/openapi.json so local-tool
// consumers can generate clients and explore the API programmatically.
//
// The document is HAND-MAINTAINED: docs/API.md and the route modules under
// src/routes/ remain the source of truth — where this document and the
// code disagree, the code wins (and this spec deserves a fix). Response
// schemas are deliberately loose (object shapes with the documented field
// names, not exhaustive JSON Schema): enough for tooling to discover
// endpoints and fields without pretending to pin every union member.
//
// The spec constant is built once at module scope (version read through
// src/version.ts — the same source /api/health reports) and serialized
// once; the handler does zero per-request work.
import { Hono } from 'hono';
import { appVersion } from '../version';

// ---------------------------------------------------------------------------
// Minimal local document types — OpenAPI 3.1-shaped, intentionally loose.
// ---------------------------------------------------------------------------

type SchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

type SchemaObject = {
  type: SchemaType;
  description?: string;
  items?: SchemaObject;
  /** Documented default for query params (display-only; the code clamps). */
  default?: string | number | boolean;
  /** Restricted value set (e.g. the literal-'1' opt-in flags). */
  enum?: string[];
  /** Regular expression the value must match (e.g. selector shapes). */
  pattern?: string;
};

type ObjectSchema = SchemaObject & {
  type: 'object';
  properties?: Record<string, SchemaObject>;
};

type MediaTypeName = 'application/json' | 'text/csv' | 'text/event-stream';

type ResponseObject = {
  description: string;
  content?: Partial<Record<MediaTypeName, { schema: ObjectSchema }>>;
};

type ParameterObject = {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description: string;
  schema: SchemaObject;
};

type RequestBodyObject = {
  required: boolean;
  description?: string;
  content: { 'application/json': { schema: ObjectSchema } };
};

type OperationObject = {
  tags: string[];
  summary: string;
  description: string;
  operationId: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
};

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type PathItemObject = Partial<Record<HttpMethod, OperationObject>>;

type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, PathItemObject>;
};

// ---------------------------------------------------------------------------
// Small builders — the spec is data, these keep it readable.
// ---------------------------------------------------------------------------

const str = (description?: string): SchemaObject => ({
  type: 'string',
  ...(description ? { description } : {}),
});

const int = (description?: string): SchemaObject => ({
  type: 'integer',
  ...(description ? { description } : {}),
});

const bool = (description?: string): SchemaObject => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});

const arr = (items: SchemaObject, description?: string): SchemaObject => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});

const fields = (
  properties: Record<string, SchemaObject>,
  description?: string,
): ObjectSchema => ({
  type: 'object',
  properties,
  ...(description ? { description } : {}),
});

const ok = (schema: ObjectSchema, description = 'Success.'): ResponseObject => ({
  description,
  content: { 'application/json': { schema } },
});

const errorBody = fields({
  error: str('Machine-readable reason code'),
  message: str('Optional human-readable detail'),
});

const error = (status: string, description: string): ResponseObject => ({
  description,
  content: { 'application/json': { schema: errorBody } },
});

const noContent = (description: string): ResponseObject => ({ description });

const jsonBody = (schema: ObjectSchema, description?: string): RequestBodyObject => ({
  required: true,
  ...(description ? { description } : {}),
  content: { 'application/json': { schema } },
});

const chainIdParam = (): ParameterObject => ({
  name: 'chainId',
  in: 'path',
  required: true,
  description:
    'EVM chain id — any viem/chains entry or a user-registered custom chain. '
    + 'Unknown ids → 400 { "error": "Unsupported chain" }.',
  schema: int('Chain id as a decimal integer'),
});

const addressParam = (): ParameterObject => ({
  name: 'address',
  in: 'path',
  required: true,
  description: 'Hex EVM address (checksummed or all-lowercase).',
  schema: str('0x-prefixed 20-byte hex address'),
});

const q = (name: string, description: string, schema?: SchemaObject): ParameterObject => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: schema ?? str(),
});

// Auth tier notes (mirrors the 🔓/🔐/🔒 legend in docs/API.md).
const AUTH_OPEN = '🔓 Open — no authentication required.';
const AUTH_OPT_IN =
  '🔐 Admin (opt-in tier): send the `x-admin-token` header matching the server\'s '
  + 'ADMIN_TOKEN env — enforced only when ADMIN_TOKEN is configured; a zero-config '
  + 'local session passes through.';
const AUTH_STRICT =
  '🔒 Admin (fail-closed tier): requires ADMIN_TOKEN to be configured on the server '
  + 'plus the `x-admin-token` header on the request — 403 otherwise.';

const tsProp: SchemaObject = str('Response timestamp (ISO-8601 UTC)');
const chainProps: Record<string, SchemaObject> = {
  chainId: int(),
  chainName: str(),
};

// Shared loose response shapes.
const transactionShape: SchemaObject = fields({
  hash: str(),
  blockNumber: int(),
  from: str(),
  to: str(),
  value: str('Decimal-string wei (BigInt-exact)'),
  timestamp: str(),
});

const scanJobShape: ObjectSchema = fields({
  status: str('pending | running | paused | error | complete'),
  fromBlock: int(),
  toBlock: int(),
  cursorBlock: int('Highest contiguously verified block; fromBlock-1 before progress'),
  blocksWalked: int(),
  blocksTotal: int(),
  txsFound: int(),
  errorMessage: str('null unless status = error'),
  coverage: str('\'complete\' only for a finished genesis-anchored walk, else null'),
  updatedAt: str(),
});

// ---------------------------------------------------------------------------
// The document itself.
// ---------------------------------------------------------------------------

export const openApiDocument: OpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'My Block Explorer API',
    version: appVersion(),
    description:
      'Hand-maintained OpenAPI description of this local block explorer\'s backend. '
      + 'It covers the stable core surface; docs/API.md and the route modules under '
      + 'src/routes/ remain the source of truth — where this document and the code '
      + 'disagree, the code wins. Response schemas are deliberately loose (documented '
      + 'field names, not exhaustive JSON Schema). Reads are open; writes are gated by '
      + 'the `x-admin-token` header in two tiers (see each operation\'s description). '
      + 'Common response headers: X-Data-Source, X-Chain-Name. Failures return '
      + '{ "error": string, "message"?: string } with conventional status codes.',
  },
  servers: [
    {
      url: '/api',
      description:
        'Relative form — resolves against whatever host serves this explorer '
        + '(standalone server :8201, or the Vite dev bridge :3000).',
    },
  ],
  tags: [
    { name: 'Meta', description: 'Endpoint index, liveness/posture probe, and this document.' },
    { name: 'Search', description: 'Universal and chain-scoped search (address / tx hash / block number).' },
    { name: 'Stats', description: 'Cross-chain aggregate statistics.' },
    { name: 'Blocks', description: 'Block reads and the SSE block stream.' },
    { name: 'Transactions', description: 'Transaction detail and lists.' },
    { name: 'Addresses', description: 'Persistent address data, heuristic transaction history, transfers, approvals.' },
    { name: 'Deep Scan', description: 'Persistent resumable address transaction-discovery jobs.' },
    { name: 'Contracts', description: 'Cached source/ABI and read/simulate/gas interactions.' },
    { name: 'Events', description: 'Per-contract range-based event indexing and querying.' },
    { name: 'Signatures', description: 'Batched function-selector / event-topic0 lookup (openchain-backed cache).' },
    { name: 'Labels', description: 'Per-address annotations pinned to a chain, plus the cross-chain list.' },
    { name: 'Custom Chains', description: 'User-registered EVM chains outside viem/chains.' },
    { name: 'Chains', description: 'Chain-scoped cache maintenance.' },
    { name: 'RPC Configs', description: 'Server-wide per-chain RPC overrides (URLs redacted for untrusted readers).' },
    { name: 'Watch', description: 'Server-side address watch subscriptions with webhook delivery.' },
    { name: 'Ops', description: 'Local operator dashboard snapshot.' },
    { name: 'SQL Console', description: 'Read-only queries against the explorer\'s own DuckDB (strict admin).' },
  ],
  paths: {
    '/': {
      get: {
        tags: ['Meta'],
        summary: 'Endpoint index',
        description: `Static index of the API's main entry points. ${AUTH_OPEN}`,
        operationId: 'getApiIndex',
        responses: {
          200: ok(fields({
            name: str(),
            version: str('App version (same source as /health)'),
            description: str(),
            endpoints: fields({}, 'Map of capability → path template'),
          })),
        },
      },
    },
    '/health': {
      get: {
        tags: ['Meta'],
        summary: 'Liveness and deployment posture',
        description:
          `Used by frontend service discovery. The two booleans let an operator verify `
          + `the security posture from outside. ${AUTH_OPEN}`,
        operationId: 'getHealth',
        responses: {
          200: ok(fields({
            status: str('"ok"'),
            adminTokenConfigured: bool(),
            debugApiEnabled: bool(),
            version: str(),
            timestamp: str(),
          })),
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Meta'],
        summary: 'This OpenAPI document',
        description:
          `The hand-maintained OpenAPI description of the stable core surface. `
          + `Served with a generous Cache-Control (public, max-age=3600); it leaks no `
          + `secrets, so it is deliberately ungated. ${AUTH_OPEN}`,
        operationId: 'getOpenapiDocument',
        responses: {
          200: ok(fields({}, 'The OpenAPI document itself (this file\'s content).')),
        },
      },
    },

    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Detect and resolve a search query',
        description:
          `Detects address / tx hash / block number. With a valid chainId, hash and `
          + `block-number queries resolve on that chain directly; without one they return `
          + `needsChain + the curated popular-chain picker. Rate limit 30/min · burst 10. ${
            AUTH_OPEN}`,
        operationId: 'searchGlobal',
        parameters: [
          q('q', 'Search term (address, tx hash, block number, or free text).', {
            type: 'string',
          }),
          q('chainId', 'Optional chain hint — scopes hash/block resolution.', int()),
        ],
        responses: {
          200: ok(fields({
            found: bool(),
            type: str('Detected type'),
            query: str('Sanitized input'),
            searchedChainId: int('Chain free-text/address search actually ran on'),
            needsChain: bool('Present when a hash/block query is ambiguous'),
            scope: str('"popular" alongside supportedChains'),
            supportedChains: arr(fields({
              chainId: int(),
              name: str(),
              symbol: str(),
            })),
            suggestionsChainId: str('Chain suggestion data resolved on (number | null)'),
            degraded: bool('Present when suggestion enrichment failed'),
            timestamp: str(),
          })),
          400: error('400', 'Missing q parameter.'),
        },
      },
    },
    '/chains/{chainId}/search': {
      get: {
        tags: ['Search'],
        summary: 'Chain-scoped search',
        description:
          `Same detection as /search but pinned to the path chain — no picker round-trip. `
          + `Echoes suggestionsChainId (equals the path chain when suggestion data exists). ${
            AUTH_OPEN}`,
        operationId: 'searchOnChain',
        parameters: [
          chainIdParam(),
          q('q', 'Search term.', { type: 'string' }),
        ],
        responses: {
          200: ok(fields({
            found: bool(),
            type: str(),
            query: str(),
            suggestionsChainId: str('number | null'),
            timestamp: str(),
          })),
          400: error('400', 'Unsupported chain or missing q.'),
        },
      },
    },

    '/stats/overview': {
      get: {
        tags: ['Stats'],
        summary: 'Aggregate stats across popular chains',
        description:
          `Hybrid view: DuckDB index counts plus live RPC head probes (3s budget each). ${
            AUTH_OPEN}`,
        operationId: 'getStatsOverview',
        responses: {
          200: ok(fields({
            supportedChains: int(),
            displayedChains: int(),
            connectedChains: int(),
            indexedChains: int(),
            totalIndexedBlocks: int(),
            totalIndexedTransactions: int(),
            chains: arr(fields({
              chainId: int(),
              chainName: str(),
              chainSymbol: str(),
              latestBlockNumber: str('Live RPC head (decimal string) or null'),
              isIndexed: bool(),
              indexedBlocks: int(),
              indexedTransactions: int(),
              latestIndexedBlock: str('Decimal string or null'),
              avgBlockTime: str(),
              successRate: int('0..1 fraction'),
              rpcConnected: bool(),
            })),
            timestamp: str(),
          })),
        },
      },
    },

    '/chains/{chainId}/blocks/latest': {
      get: {
        tags: ['Blocks'],
        summary: 'Latest block',
        description: `Live RPC read (X-Data-Source: blockchain). ${AUTH_OPEN}`,
        operationId: 'getLatestBlock',
        parameters: [chainIdParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            block: fields({
              number: int(),
              hash: str(),
              timestamp: str(),
              transactionCount: int(),
              gasUsed: str(),
            }),
            timestamp: tsProp,
          })),
        },
      },
    },
    '/chains/{chainId}/blocks/{blockNumber}': {
      get: {
        tags: ['Blocks'],
        summary: 'Block by height',
        description: `Live RPC read. ${AUTH_OPEN}`,
        operationId: 'getBlockByNumber',
        parameters: [
          chainIdParam(),
          {
            name: 'blockNumber',
            in: 'path',
            required: true,
            description: 'Decimal block height.',
            schema: int(),
          },
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            block: fields({ number: int(), hash: str(), timestamp: str() }),
            timestamp: tsProp,
          })),
          404: error('404', 'Block not found.'),
        },
      },
    },
    '/chains/{chainId}/blocks': {
      get: {
        tags: ['Blocks'],
        summary: 'Block list',
        description: `Newest-first page over the indexed block cache. ${AUTH_OPEN}`,
        operationId: 'listBlocks',
        parameters: [
          chainIdParam(),
          q('limit', 'Page size.', { type: 'integer', default: 20 }),
          q('offset', 'Pagination offset.', { type: 'integer', default: 0 }),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            blocks: arr(fields({ number: int(), hash: str(), timestamp: str() })),
            total: int(),
            timestamp: tsProp,
          })),
        },
      },
    },
    '/chains/{chainId}/blocks/stream': {
      get: {
        tags: ['Blocks'],
        summary: 'SSE stream of new blocks',
        description:
          `Server-Sent Events (hono/streaming): one \`block\` event per new block; the `
          + `connect-time head is a baseline (no event). Heartbeat comment every 15s; `
          + `catch-up capped at the 10 newest blocks after a stall; reorg head-drops `
          + `resync the baseline. When watch subscriptions exist for the chain, named `
          + `\`watch\` events ride the same stream. Unknown chain / no RPC / 10 consecutive `
          + `poll failures → one \`error\` event, then close. Rate limit 12/min · burst 6. ${
            AUTH_OPEN}`,
        operationId: 'streamBlocks',
        parameters: [chainIdParam()],
        responses: {
          200: {
            description: 'SSE stream (text/event-stream).',
            content: {
              'text/event-stream': {
                schema: fields({
                  event: str('block | watch | error'),
                  data: str('JSON payload; block events carry {number, hash, parentHash, timestamp, miner, transactionCount, gasUsed, gasLimit, baseFeePerGas?, sizeBytes?}'),
                }),
              },
            },
          },
          429: error('429', 'Rate limited (Retry-After header set).'),
        },
      },
    },

    '/chains/{chainId}/transactions/{hash}': {
      get: {
        tags: ['Transactions'],
        summary: 'Transaction detail',
        description: `Live RPC read by hash. ${AUTH_OPEN}`,
        operationId: 'getTransactionByHash',
        parameters: [
          chainIdParam(),
          {
            name: 'hash',
            in: 'path',
            required: true,
            description: '32-byte transaction hash.',
            schema: str('0x-prefixed 32-byte hex'),
          },
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            transaction: transactionShape,
            timestamp: tsProp,
          })),
          404: error('404', 'Transaction not found.'),
        },
      },
    },
    '/chains/{chainId}/transactions': {
      get: {
        tags: ['Transactions'],
        summary: 'Transaction list',
        description:
          `Newest-first page over the indexed cache. limit is clamped to 100; offset `
          + `clamped to 100,000 — non-numeric/non-positive limit → 400 invalid_limit. ${
            AUTH_OPEN}`,
        operationId: 'listTransactions',
        parameters: [
          chainIdParam(),
          q('limit', 'Page size (clamped to 100).', { type: 'integer', default: 20 }),
          q('offset', 'Pagination offset (clamped to 100,000).', { type: 'integer', default: 0 }),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            transactions: arr(transactionShape),
            total: int(),
            timestamp: tsProp,
          })),
          400: error('400', 'invalid_limit / Invalid offset.'),
        },
      },
    },

    '/chains/{chainId}/addresses/{address}': {
      get: {
        tags: ['Addresses'],
        summary: 'Persistent address data',
        description:
          `Persistent (DuckDB) data only — no balance, no transaction count; the UI `
          + `reads those live from RPC. ${AUTH_OPEN}`,
        operationId: 'getAddressInfo',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: fields({}, 'Persistent address record (labels, contract metadata, …)'),
            timestamp: tsProp,
          })),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/persistent': {
      get: {
        tags: ['Addresses'],
        summary: 'Persistent address data (explicit alias)',
        description: `Same payload as GET .../addresses/{address}, explicit variant. ${AUTH_OPEN}`,
        operationId: 'getAddressPersistentData',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str('Address echoed'),
            timestamp: tsProp,
          }, 'Plus the persistent fields spread at the top level.')),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/transactions': {
      get: {
        tags: ['Addresses'],
        summary: 'Heuristic transaction history',
        description:
          `Balance-change binary-search discovery (NOT complete history — see coverage). `
          + `total counts discovered transactions only; coverage is never 'complete' via `
          + `the heuristic alone (a finished genesis-anchored deep scan is the only lift). `
          + `Additive filter params (fromAddress/toAddress/minValue/maxValue/method) `
          + `narrow the SAME cached discovered set — no new scan, coverage never claimed. `
          + `Rate limit 10/min · burst 3. ${AUTH_OPEN}`,
        operationId: 'listAddressTransactions',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('limit', 'Page size (clamped to 50). Non-numeric/non-positive → 400 invalid_limit.', {
            type: 'integer',
            default: 20,
          }),
          q('page', '1-based page (clamped to ≥1). Non-numeric → 400 invalid_page.', {
            type: 'integer',
            default: 1,
          }),
          q('window', 'Search window in blocks (clamped 1–50,000,000); only fully-numeric values count.', int()),
          q('balanceHistory', 'Opt in with the literal \'1\' only: adds balancePoints + balancePointsCount.', {
            type: 'string',
            enum: ['1'],
          }),
          q('fromAddress', 'Filter: sender address (400 invalid_address on bad shape).', str('hex address')),
          q('toAddress', 'Filter: recipient address (400 invalid_address on bad shape).', str('hex address')),
          q('minValue', 'Filter: minimum value, non-negative integer wei string (400 invalid_value).', str('decimal wei')),
          q('maxValue', 'Filter: maximum value, non-negative integer wei string (400 invalid_value).', str('decimal wei')),
          q('method', 'Filter: executed function selector (400 invalid_method otherwise).', {
            type: 'string',
            pattern: '^0x[0-9a-fA-F]{8}$',
            description: '0x + 8 hex characters',
          }),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            transactions: arr(transactionShape),
            total: int('Discovered (or filtered) count — never the nonce'),
            pagination: fields({ page: int(), limit: int(), totalPages: int(), total: int() }),
            method: str('Discovery method tag (also the X-Data-Source header)'),
            coverage: str('complete | partial | none'),
            reason: str('Why coverage is what it is (deep-scan lifts report \'deep-scan\')'),
            searchWindowBlocks: int('Effective discovery window'),
            balancePoints: arr(fields({
              blockNumber: int(),
              timestamp: str(),
              cumulativeValue: str('Cumulative discovered native-value delta, decimal string'),
            }), 'Present only with balanceHistory=1; first point anchors at 0'),
            balancePointsCount: int('Present only with balanceHistory=1'),
            filtersApplied: fields({}, 'Echo of filter params exactly as received — present only when ≥1 filter was sent'),
            deepScan: scanJobShape,
            timestamp: tsProp,
          })),
          400: error('400', 'invalid_limit / invalid_page / invalid_address / invalid_value / invalid_method.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/transactions/export': {
      get: {
        tags: ['Addresses'],
        summary: 'CSV export of the discovered transaction set',
        description:
          `Same discovered set (and same params/validation) as the transactions list, `
          + `serialized as CSV — the download always matches what the list shows. `
          + `Refuses (400 too_many_rows) instead of silently truncating. Rate limit `
          + `5/min · burst 2. ${AUTH_OPEN}`,
        operationId: 'exportAddressTransactions',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('window', 'Search window in blocks (same semantics as the list endpoint).', int()),
          q('offset', 'Non-negative integer row offset for chunked exports (default 0).', {
            type: 'integer',
            default: 0,
          }),
        ],
        responses: {
          200: {
            description: 'CSV attachment (text/csv; Content-Disposition filename carries chain/address/timestamp).',
            content: { 'text/csv': { schema: fields({}, 'CSV rows of the discovered set') } },
          },
          400: error('400', 'invalid_offset / too_many_rows.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/transfers': {
      get: {
        tags: ['Addresses'],
        summary: 'On-demand token-transfer scan',
        description:
          `ERC-20/721/1155 transfer list via eth_getLogs (no DuckDB writes), cached ~60s `
          + `per address+window. Rows carry logStandard when the log shape proves it. `
          + `Rate limit 10/min · burst 3. ${AUTH_OPEN}`,
        operationId: 'listAddressTransfers',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('cursor', '0-based cursor into the scanned set.', { type: 'integer', default: 0 }),
          q('limit', 'Page size (1–100).', { type: 'integer', default: 25 }),
          q('window', 'Scanned range in blocks (1–50,000,000).', int()),
          q('refresh', 'Literal \'1\' skips the ~60s scan cache (a genuine re-scan).', {
            type: 'string',
            enum: ['1'],
          }),
          q('mode', 'Row filter shape; an explicit unknown value → 400 invalid_mode.', {
            type: 'string',
            enum: ['token', 'participant'],
            default: 'participant',
          }),
        ],
        responses: {
          200: ok(fields({
            transfers: arr(fields({
              token: str(),
              from: str(),
              to: str(),
              value: str(),
              logStandard: str('erc20 | erc721 | erc1155 (when provable from log shape)'),
            })),
            nextCursor: str('Opaque continuation cursor, null on the last page'),
            coverage: str('complete | partial'),
            windowBlocks: int(),
            scannedAt: str('First-scan time of the cache entry (ISO-8601)'),
            mode: str('Filter shape that produced these rows'),
          })),
          400: error('400', 'invalid_mode.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/approvals': {
      get: {
        tags: ['Addresses'],
        summary: 'Read-only approvals viewer',
        description:
          `Owner-filtered Approval/ApprovalForAll sweeps → distinct pairs/triples → `
          + `Multicall3 current-state reads (capped at 100 across kinds → truncated: `
          + `true). Rate limit 10/min · burst 3. ${AUTH_OPEN}`,
        operationId: 'listAddressApprovals',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('window', 'Sweep window in blocks.', int()),
          q('refresh', 'Literal \'1\' skips the scan cache.', { type: 'string', enum: ['1'] }),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            approvals: arr(fields({
              kind: str('erc20 | erc721 | erc1155'),
              token: str(),
              spender: str(),
              allowance: str('erc20: BigInt-exact decimal string'),
              isMax: bool('erc20: allowance ≥ 2^128 sentinel'),
              tokenId: str('erc721/erc1155'),
            })),
            scannedAt: str(),
            windowBlocks: int(),
            coverage: str('Window-scoped, never full-history'),
            pairCount: int('Pre-cap discovery total across all kinds'),
            truncated: bool(),
            history: arr(fields({}, 'Raw retained approval events, newest-first (absent when none)')),
            historyTruncated: bool(),
          })),
        },
      },
    },

    '/chains/{chainId}/addresses/{address}/scan': {
      post: {
        tags: ['Deep Scan'],
        summary: 'Start (or idempotently return) a deep-scan job',
        description:
          `Persistent resumable address tx discovery. Bounds resolve once at creation. `
          + `202 created · 200 idempotent (equal bounds; also restarts an errored/paused `
          + `job) · 400 scan_conflict for different bounds without force (force replaces `
          + `bounds, wipes findings, resets the cursor). Rate limit 3/min · burst 2. ${
            AUTH_OPT_IN}`,
        operationId: 'startAddressScan',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          fromBlock: str('number or \'earliest\' (default earliest)'),
          toBlock: str('number or \'latest\' (default latest)'),
          force: bool('Replace an existing job with different bounds'),
          includeTraces: bool('Opt into internal-transaction tracing when the provider supports it'),
        }), 'All fields optional; tags resolve once at creation.'),
        responses: {
          200: ok(scanJobShape, 'Idempotent — existing job with equal bounds.'),
          202: ok(scanJobShape, 'Job created (background walk started).'),
          400: error('400', 'invalid_bounds / scan_conflict.'),
        },
      },
      get: {
        tags: ['Deep Scan'],
        summary: 'Read the deep-scan job',
        description: AUTH_OPEN,
        operationId: 'getAddressScanJob',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(scanJobShape),
          404: error('404', 'no_scan_job.'),
        },
      },
      delete: {
        tags: ['Deep Scan'],
        summary: 'Remove the job row and its findings',
        description: `Idempotent delete (204). ${AUTH_OPT_IN}`,
        operationId: 'deleteAddressScan',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          204: noContent('Job and findings removed.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/scan/internal-transactions': {
      get: {
        tags: ['Deep Scan'],
        summary: 'Internal transactions recorded by a traced deep scan',
        description:
          `Paginated newest-first page over trace rows a traced walk recorded. No rows `
          + `(unknown address, tracing not opted in, unsupported provider) is an honest `
          + `empty page, never an error. ${AUTH_OPEN}`,
        operationId: 'listAddressScanInternalTransactions',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('limit', 'Page size.', { type: 'integer', default: 20 }),
          q('offset', 'Pagination offset.', { type: 'integer', default: 0 }),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            transactions: arr(fields({
              blockNumber: int(),
              transactionHash: str(),
              from: str(),
              to: str(),
              value: str('Decimal-string wei'),
            })),
            total: int(),
            timestamp: tsProp,
          })),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/scan/pause': {
      post: {
        tags: ['Deep Scan'],
        summary: 'Pause a running deep scan',
        description: `202 {job}; settles at its last checkpointed cursor. 400 invalid_state when not running. ${AUTH_OPT_IN}`,
        operationId: 'pauseAddressScan',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          202: ok(scanJobShape),
          400: error('400', 'invalid_state.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/scan/resume': {
      post: {
        tags: ['Deep Scan'],
        summary: 'Resume a paused deep scan',
        description: `202 {job}; 400 invalid_state when not paused (errored jobs recover via same-bounds POST .../scan). ${AUTH_OPT_IN}`,
        operationId: 'resumeAddressScan',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          202: ok(scanJobShape),
          400: error('400', 'invalid_state.'),
        },
      },
    },
    '/chains/{chainId}/addresses/{address}/scan/catchup': {
      post: {
        tags: ['Deep Scan'],
        summary: 'Extend a settled walk to the current chain head',
        description:
          `Preserves cursor + findings (no re-walk; blocksTotal recomputed). 202 {job}; `
          + `404 no_scan_job; 400 invalid_state when running; 400 already_caught_up. ${
            AUTH_OPT_IN}`,
        operationId: 'catchupAddressScan',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          202: ok(scanJobShape),
          400: error('400', 'invalid_state / already_caught_up.'),
          404: error('404', 'no_scan_job.'),
        },
      },
    },

    '/chains/{chainId}/contracts/{address}/source': {
      get: {
        tags: ['Contracts'],
        summary: 'Verified source and metadata',
        description: `DB cache → Sourcify → Etherscan fallback (immutable once cached). ${AUTH_OPEN}`,
        operationId: 'getContractSource',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            contractSource: fields({
              verificationStatus: str(),
              verificationSource: str(),
              isProxy: bool(),
              abi: arr(fields({}, 'ABI entry')),
              sources: fields({}, 'File name → content'),
            }),
            timestamp: tsProp,
          })),
          404: error('404', 'not_a_contract (no deployed code at this address).'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/abi': {
      get: {
        tags: ['Contracts'],
        summary: 'ABI plus decoded functions/events/errors',
        description: `Decoded views over the cached ABI; proxy implementations are followed. ${AUTH_OPEN}`,
        operationId: 'getContractAbi',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            abi: arr(fields({}, 'ABI entry')),
            functions: arr(fields({ name: str(), type: str(), inputs: arr(fields({})) })),
            events: arr(fields({ name: str(), type: str() })),
            errors: arr(fields({ name: str(), type: str() })),
            verificationStatus: str(),
            timestamp: tsProp,
          })),
          404: error('404', 'not_a_contract.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/read': {
      post: {
        tags: ['Contracts'],
        summary: 'Read-only contract call',
        description: `State-changing-free eth_call through the cached ABI (proxy-aware). Rate limit 60/min · burst 20. ${AUTH_OPEN}`,
        operationId: 'readContract',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          functionName: str('Required — ABI function name'),
          args: arr(str(), 'Positional arguments (default [])'),
        })),
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            functionName: str(),
            args: arr(str()),
            result: fields({}, 'Decoded return values'),
            success: bool(),
            error: str('Revert reason when unsuccessful'),
            timestamp: tsProp,
          })),
          400: error('400', 'Missing/invalid functionName/args, ABI unavailable, or the call reverted.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/simulate': {
      post: {
        tags: ['Contracts'],
        summary: 'eth_call simulation with optional state override',
        description:
          `Same body as estimate-gas. stateOverride is a foundry-style map applied by `
          + `the node for this call only (≤10 addresses, ≤32 slots per map; violations → `
          + `400 invalid_state_override with per-field details). Rate limit 60/min · burst 20. ${
            AUTH_OPEN}`,
        operationId: 'simulateContractCall',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          functionName: str('Required'),
          args: arr(str(), 'Positional arguments (default [])'),
          value: str('msg.value in wei'),
          from: str('Simulated sender address'),
          stateOverride: fields({}, 'Address → { balance?, nonce?, code?, state?, stateDiff? }'),
        })),
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            functionName: str(),
            result: fields({}, 'Decoded return values'),
            success: bool(),
            error: str(),
            gasUsed: str('Decimal string when available'),
            timestamp: tsProp,
          })),
          400: error('400', 'Validation errors or simulation failure (success: false is a 400).'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/estimate-gas': {
      post: {
        tags: ['Contracts'],
        summary: 'Gas estimate (simulate body, incl. stateOverride)',
        description:
          `Same body and override rules as simulate; the override scopes the estimate to `
          + `this call only. Support depends on the upstream RPC. ${AUTH_OPEN}`,
        operationId: 'estimateContractGas',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          functionName: str('Required'),
          args: arr(str(), 'Positional arguments (default [])'),
          value: str('msg.value in wei'),
          from: str(),
          stateOverride: fields({}, 'Same foundry-style map as simulate'),
        })),
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            functionName: str(),
            gasEstimate: str('Decimal string'),
            success: bool(),
            error: str(),
            timestamp: tsProp,
          })),
          400: error('400', 'Validation errors or estimation failure.'),
        },
      },
    },

    '/chains/{chainId}/contracts/{address}/events': {
      get: {
        tags: ['Events'],
        summary: 'Query indexed contract events',
        description:
          `Page over the per-chain event index with decoded-argument filtering pushed `
          + `into DuckDB (argFilters/topicN). pageSize clamped to 1,000. Failures are a `
          + `loud 500, never a success-shaped empty page. ${AUTH_OPEN}`,
        operationId: 'listContractEvents',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('page', '1-based page.', { type: 'integer', default: 1 }),
          q('pageSize', 'Page size (clamped to 1,000).', { type: 'integer', default: 50 }),
          q('eventName', 'Exact event name filter.'),
          q('fromBlock', 'Inclusive lower block bound.', int()),
          q('toBlock', 'Inclusive upper block bound.', int()),
          q('argFilters', 'JSON object of decoded-argument equality filters, e.g. {"from":"0x…"} (400 on non-object JSON).'),
          q('topic0', 'Raw topic hash filter (lowercased).', str('32-byte hex')),
          q('topic1', 'Raw topic filter.', str('32-byte hex')),
          q('topic2', 'Raw topic filter.', str('32-byte hex')),
          q('topic3', 'Raw topic filter.', str('32-byte hex')),
        ],
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            events: arr(fields({
              eventName: str(),
              blockNumber: int(),
              transactionHash: str(),
              logIndex: int(),
              args: fields({}, 'Decoded event arguments'),
              isFinalized: bool(),
            })),
            total: int(),
            page: int(),
            pageSize: int(),
            timestamp: tsProp,
          })),
          500: error('500', 'internal_error — never a zeroed success page.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/statistics': {
      get: {
        tags: ['Events'],
        summary: 'Event indexing statistics',
        description: `Includes the overlap-safe "Indexing coverage" union of walked blocks. ${AUTH_OPEN}`,
        operationId: 'getContractEventStatistics',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            totalEvents: int(),
            uniqueEvents: int(),
            blocksWithEvents: int(),
            coverage: fields({
              blocksCovered: int(),
              totalBlocks: int(),
              percentage: int(),
            }),
            timestamp: tsProp,
          })),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/indexing-status': {
      get: {
        tags: ['Events'],
        summary: 'Current indexing job status',
        description:
          `Status of the serial per-range job. Failures → 503 indexing_status_unavailable, `
          + `never a zeroed status object. ${AUTH_OPEN}`,
        operationId: 'getContractEventIndexingStatus',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            isIndexing: bool(),
            currentRangeId: int(),
            totalRanges: int(),
            timestamp: tsProp,
          })),
          503: error('503', 'indexing_status_unavailable.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/export': {
      get: {
        tags: ['Events'],
        summary: 'CSV export of the filtered event set',
        description:
          `Streams the filtered set as CSV (is_finalized column included). Hard cap `
          + `100,000 rows → 400 (refuses instead of truncating). Rate limit 5/min · burst 2. ${
            AUTH_OPEN}`,
        operationId: 'exportContractEvents',
        parameters: [
          chainIdParam(),
          addressParam(),
          q('eventName', 'Exact event name filter.'),
          q('fromBlock', 'Inclusive lower block bound.', int()),
          q('toBlock', 'Inclusive upper block bound.', int()),
          q('argFilters', 'JSON object of decoded-argument equality filters.'),
          q('topic0', 'Raw topic hash filter.', str('32-byte hex')),
        ],
        responses: {
          200: {
            description: 'CSV attachment (text/csv).',
            content: { 'text/csv': { schema: fields({}, 'CSV rows incl. is_finalized') } },
          },
          400: error('400', 'Export limit exceeded (100,000 rows) or invalid filters.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges': {
      get: {
        tags: ['Events'],
        summary: 'List indexing ranges',
        description: `All ranges for the contract (the UI polls every 3s while indexing). ${AUTH_OPEN}`,
        operationId: 'listEventIndexingRanges',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            ranges: arr(fields({
              id: int(),
              fromBlock: int('Concrete number — tags were resolved at creation'),
              toBlock: int(),
              status: str('pending | indexing | paused | completed | error'),
              eventsIndexed: int(),
              createdAt: str(),
              updatedAt: str(),
            })),
            timestamp: tsProp,
          })),
        },
      },
      post: {
        tags: ['Events'],
        summary: 'Add an indexing range',
        description:
          `Bounds accept a block number or a tag (latest/finalized/safe/earliest) — `
          + `tags resolve to concrete numbers once, at creation. ${AUTH_OPT_IN}`,
        operationId: 'createEventIndexingRange',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          fromBlock: str('Required — number or block tag'),
          toBlock: str('Required — number or block tag'),
          direction: str('Optional walk direction'),
          priority: int('Optional queue priority'),
        })),
        responses: {
          201: ok(fields({
            ...chainProps,
            contractAddress: str(),
            rangeId: int(),
            overlaps: arr(fields({})),
            truncatedToBlock: int('Present when a numeric toBlock was clamped to the chain head'),
            timestamp: tsProp,
          })),
          400: error('400', 'Invalid bounds or overlapping range.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges/quick': {
      post: {
        tags: ['Events'],
        summary: 'Quick-create a range by mode',
        description:
          `Modes: all | recent | first | continue | catchup (recent/first/continue also `
          + `need blockCount). Quick-created ranges auto-start server-side (response `
          + `carries started/startError). ${AUTH_OPT_IN}`,
        operationId: 'quickCreateEventIndexingRange',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          mode: str('Required — all | recent | first | continue | catchup'),
          blockCount: int('Required for recent/first/continue'),
          direction: str(),
          priority: int(),
          abi: arr(fields({}), 'Optional ABI used for decoding'),
          confirmFullHistory: bool('Explicit confirmation unlocking mode=all over a huge span'),
        })),
        responses: {
          201: ok(fields({
            ...chainProps,
            contractAddress: str(),
            rangeId: int(),
            fromBlock: int(),
            toBlock: int(),
            started: bool(),
            startError: str(),
            timestamp: tsProp,
          })),
          400: error('400', 'Invalid mode/blockCount, no previous range for catchup, or full-history confirmation required.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges/{rangeId}': {
      patch: {
        tags: ['Events'],
        summary: 'Update an indexing range',
        description: AUTH_OPT_IN,
        operationId: 'updateEventIndexingRange',
        parameters: [
          chainIdParam(),
          addressParam(),
          {
            name: 'rangeId',
            in: 'path',
            required: true,
            description: 'Numeric range id.',
            schema: int(),
          },
        ],
        requestBody: jsonBody(fields({
          fromBlock: str('Number or block tag (optional here)'),
          toBlock: str('Number or block tag (optional here)'),
          direction: str(),
          priority: int(),
        })),
        responses: {
          200: ok(fields({
            ...chainProps,
            contractAddress: str(),
            rangeId: int(),
            overlaps: arr(fields({})),
            timestamp: tsProp,
          })),
          400: error('400', 'Invalid rangeId/bounds or overlap.'),
        },
      },
      delete: {
        tags: ['Events'],
        summary: 'Delete an indexing range',
        description: `400 while the range is indexing; 404 for unknown rangeId. ${AUTH_OPT_IN}`,
        operationId: 'deleteEventIndexingRange',
        parameters: [
          chainIdParam(),
          addressParam(),
          {
            name: 'rangeId',
            in: 'path',
            required: true,
            description: 'Numeric range id.',
            schema: int(),
          },
        ],
        responses: {
          200: ok(fields({ ...chainProps, contractAddress: str(), rangeId: int(), timestamp: tsProp })),
          400: error('400', 'Range is currently indexing.'),
          404: error('404', 'Range not found.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges/{rangeId}/start': {
      post: {
        tags: ['Events'],
        summary: 'Start indexing a range',
        description: `Returns 202 immediately; progress via GET .../events polling. ${AUTH_OPT_IN}`,
        operationId: 'startIndexingRange',
        parameters: [
          chainIdParam(),
          addressParam(),
          {
            name: 'rangeId',
            in: 'path',
            required: true,
            description: 'Numeric range id.',
            schema: int(),
          },
        ],
        responses: {
          202: ok(fields({ ...chainProps, contractAddress: str(), rangeId: int(), message: str(), timestamp: tsProp })),
          400: error('400', 'Already indexing or completed.'),
          404: error('404', 'Range not found.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges/{rangeId}/pause': {
      post: {
        tags: ['Events'],
        summary: 'Pause indexing a range',
        description: AUTH_OPT_IN,
        operationId: 'pauseIndexingRange',
        parameters: [
          chainIdParam(),
          addressParam(),
          {
            name: 'rangeId',
            in: 'path',
            required: true,
            description: 'Numeric range id.',
            schema: int(),
          },
        ],
        responses: {
          200: ok(fields({ ...chainProps, contractAddress: str(), rangeId: int(), timestamp: tsProp })),
          400: error('400', 'Not indexing.'),
          404: error('404', 'Range not found.'),
        },
      },
    },
    '/chains/{chainId}/contracts/{address}/events/ranges/{rangeId}/resume': {
      post: {
        tags: ['Events'],
        summary: 'Resume indexing a paused range',
        description: `Returns 202 immediately. ${AUTH_OPT_IN}`,
        operationId: 'resumeIndexingRange',
        parameters: [
          chainIdParam(),
          addressParam(),
          {
            name: 'rangeId',
            in: 'path',
            required: true,
            description: 'Numeric range id.',
            schema: int(),
          },
        ],
        responses: {
          202: ok(fields({ ...chainProps, contractAddress: str(), rangeId: int(), message: str(), timestamp: tsProp })),
          400: error('400', 'Not paused.'),
          404: error('404', 'Range not found.'),
        },
      },
    },

    '/signatures': {
      get: {
        tags: ['Signatures'],
        summary: 'Batched selector / topic0 signature lookup',
        description:
          `Repeatable \`function\` (0x + 8 hex) and \`event\` (0x + 64 hex) query params, `
          + `each also accepting comma-batched values; ≤25 unique selectors per call. `
          + `Served from the DuckDB cache first, openchain-backed. ${AUTH_OPEN}`,
        operationId: 'lookupSignatures',
        parameters: [
          q('function', 'Repeatable 4-byte function selector (0x + 8 hex chars, lowercase).', {
            type: 'string',
            pattern: '^0x[0-9a-f]{8}$',
          }),
          q('event', 'Repeatable 32-byte event topic0 hash (0x + 64 hex chars, lowercase).', {
            type: 'string',
            pattern: '^0x[0-9a-f]{64}$',
          }),
        ],
        responses: {
          200: ok(fields({
            results: fields({}, 'selector → { kind, signatures, source } | { kind, signatures: [], notFound } | { unavailable: true }'),
          })),
          400: error('400', 'invalid_selector / too_many_selectors.'),
        },
      },
    },

    '/chains/{chainId}/labels/{address}': {
      get: {
        tags: ['Labels'],
        summary: 'Read one address label',
        description: `A missing label is an explicit 404, never 200-with-nulls. ${AUTH_OPEN}`,
        operationId: 'getAddressLabel',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          200: ok(fields({
            ...chainProps,
            address: str(),
            label: str(),
            note: str(),
            source: str('builtin | user'),
            updatedAt: str(),
          })),
          404: error('404', 'label_not_found.'),
        },
      },
      put: {
        tags: ['Labels'],
        summary: 'Upsert an address label (full replace)',
        description:
          `label 1–64 chars, note ≤500 chars — violations → 400 invalid_label. PUT over `
          + `a builtin row converts it to user (user intent wins). ${AUTH_OPT_IN}`,
        operationId: 'upsertAddressLabel',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          label: str('Required, 1–64 chars'),
          note: str('Optional, ≤500 chars'),
        })),
        responses: {
          200: ok(fields({ label: str(), note: str(), source: str() })),
          400: error('400', 'invalid_label.'),
        },
      },
      delete: {
        tags: ['Labels'],
        summary: 'Delete an address label',
        description: `Absent label → 404 (idempotence would hide typos). ${AUTH_OPT_IN}`,
        operationId: 'deleteAddressLabel',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          204: noContent('Label removed.'),
          404: error('404', 'No label at this key.'),
        },
      },
    },
    '/labels': {
      get: {
        tags: ['Labels'],
        summary: 'List all labels across chains',
        description:
          `Backs the settings modal's backup/restore export. Ordered by (chainId, `
          + `address); served no-store. Rate limit 10/min · burst 3. ${AUTH_OPT_IN}`,
        operationId: 'listAllLabels',
        responses: {
          200: ok(fields({
            labels: arr(fields({
              chainId: int(),
              address: str(),
              label: str(),
              note: str(),
              source: str('builtin | user'),
              updatedAt: str(),
            })),
          })),
        },
      },
    },

    '/chains/custom': {
      get: {
        tags: ['Custom Chains'],
        summary: 'List registered custom chains',
        description:
          `rpcUrl is the full URL only for CORS-allowlisted Origins / Origin-less `
          + `loopback sockets; everyone else gets scheme + host and urlRedacted: true. ${
            AUTH_OPEN}`,
        operationId: 'listCustomChains',
        responses: {
          200: ok(fields({
            chains: arr(fields({
              chainId: int(),
              name: str(),
              symbol: str(),
              decimals: int(),
              rpcUrl: str('Full or redacted per reader trust'),
              urlRedacted: bool(),
            })),
          })),
        },
      },
      post: {
        tags: ['Custom Chains'],
        summary: 'Register a custom chain (probe-first)',
        description:
          `Probes the endpoint's eth_chainId before storing — the reported id IS the `
          + `registration's chain id. 409 chain_already_known when viem ships the id `
          + `(use the RPC override panel instead). Rate limit 5/min · burst 2. ${AUTH_OPT_IN}`,
        operationId: 'registerCustomChain',
        requestBody: jsonBody(fields({
          rpcUrl: str('Required — absolute http(s) URL'),
          name: str('Default "Chain {id}"'),
          symbol: str('Default "ETH"'),
          decimals: int('0–256, default 18'),
        })),
        responses: {
          201: ok(fields({
            chainId: int(),
            name: str(),
            symbol: str(),
            decimals: int(),
            rpcUrl: str(),
          })),
          400: error('400', 'invalid_url / invalid_fields / invalid_json.'),
          409: error('409', 'chain_already_known.'),
          502: error('502', 'rpc_unreachable / rpc_invalid_response.'),
        },
      },
    },
    '/chains/custom/{chainId}': {
      delete: {
        tags: ['Custom Chains'],
        summary: 'Remove a custom-chain registration',
        description: `The RPC manager hot-reloads and the chain stops resolving. ${AUTH_OPT_IN}`,
        operationId: 'deleteCustomChain',
        parameters: [
          {
            name: 'chainId',
            in: 'path',
            required: true,
            description: 'Registered chain id.',
            schema: int(),
          },
        ],
        responses: {
          204: noContent('Registration removed.'),
          400: error('400', 'invalid_chain_id.'),
          404: error('404', 'Nothing registered under this id.'),
        },
      },
    },

    '/rpc-configs': {
      get: {
        tags: ['RPC Configs'],
        summary: 'List server-wide RPC overrides',
        description:
          `Endpoint URLs are redacted to scheme + host for any reader the CORS policy `
          + `does not trust (they may embed API keys); every entry carries `
          + `urlRedacted so clients can tell. ${AUTH_OPEN}`,
        operationId: 'listRpcConfigs',
        responses: {
          200: ok(fields({
            configs: arr(fields({
              chainId: int(),
              name: str(),
              url: str('Full or scheme+host per reader trust'),
              urlRedacted: bool(),
              supportsHistory: bool(),
              maxEventRange: int(),
            })),
          })),
        },
      },
      post: {
        tags: ['RPC Configs'],
        summary: 'Upsert an RPC override',
        description:
          `Applies to the backend for all users; the server-wide RPC hot-reloads. `
          + `Violations → 400 with a machine-readable code. ${AUTH_OPT_IN}`,
        operationId: 'upsertRpcConfig',
        requestBody: jsonBody(fields({
          chainId: int('Required — positive integer naming a supported chain'),
          name: str('Required'),
          url: str('Required — absolute http(s) URL'),
          supportsHistory: bool('Optional'),
          maxEventRange: int('Optional — positive integer'),
        })),
        responses: {
          200: ok(fields({ success: bool(), action: str('created | replaced') })),
          400: error('400', 'invalid_chain_id / invalid_url / invalid_name / invalid_fields / missing_fields / invalid_json.'),
        },
      },
    },
    '/rpc-configs/{chainId}': {
      delete: {
        tags: ['RPC Configs'],
        summary: 'Remove an RPC override',
        description: AUTH_OPT_IN,
        operationId: 'deleteRpcConfig',
        parameters: [
          {
            name: 'chainId',
            in: 'path',
            required: true,
            description: 'Chain id of the override.',
            schema: int(),
          },
        ],
        responses: {
          200: ok(fields({ success: bool() })),
        },
      },
    },

    '/chains/{chainId}/watch': {
      get: {
        tags: ['Watch'],
        summary: 'List watch subscriptions for a chain',
        description: `Open read, served no-store, oldest-first. ${AUTH_OPEN}`,
        operationId: 'listWatchSubscriptions',
        parameters: [chainIdParam()],
        responses: {
          200: ok(fields({
            subscriptions: arr(fields({
              chainId: int(),
              address: str(),
              label: str(),
              webhookUrl: str('null when no webhook is configured'),
              webhookStatus: str('ok | \'failed: …\' | null'),
              webhookLastAt: str(),
              lastProcessedBlock: str('Decimal string | null until the first tick baselines the row'),
              createdAt: str(),
              updatedAt: str(),
            })),
          })),
        },
      },
    },
    '/chains/{chainId}/watch/{address}': {
      put: {
        tags: ['Watch'],
        summary: 'Upsert a watch subscription',
        description:
          `Watching starts at the subscription moment — it never walks history; gaps `
          + `wider than 200 blocks are skipped and reported as gap events. Cap 25 per `
          + `chain (400 watch_full); requires a configured RPC for the chain `
          + `(400 no_rpc_config). Rate limit 5/min · burst 2. ${AUTH_OPT_IN}`,
        operationId: 'upsertWatchSubscription',
        parameters: [chainIdParam(), addressParam()],
        requestBody: jsonBody(fields({
          label: str('≤100 chars; null/empty clears; absent = unchanged'),
          webhookUrl: str('http(s), ≤512 chars else 400 invalid_webhook_url; null/empty clears'),
        }), 'An empty body is a valid "no label" upsert.'),
        responses: {
          200: ok(fields({ subscription: fields({}, 'The stored subscription row') })),
          400: error('400', 'invalid_webhook_url / watch_full / no_rpc_config.'),
        },
      },
      delete: {
        tags: ['Watch'],
        summary: 'Remove a watch subscription',
        description: `Unknown address → 404. ${AUTH_OPT_IN}`,
        operationId: 'deleteWatchSubscription',
        parameters: [chainIdParam(), addressParam()],
        responses: {
          204: noContent('Subscription removed.'),
          404: error('404', 'watch_not_found.'),
        },
      },
    },
    '/chains/{chainId}/watch/events': {
      get: {
        tags: ['Watch'],
        summary: 'Recent watch events (ring buffer)',
        description:
          `Newest-first slice of the per-chain ring buffer (last 100 kept), no-store. `
          + `An oversized limit is served honestly at the cap; non-integer/non-positive → `
          + `400 invalid_limit. ${AUTH_OPEN}`,
        operationId: 'listWatchEvents',
        parameters: [
          chainIdParam(),
          q('limit', 'Default 25, capped at 100.', { type: 'integer', default: 25 }),
        ],
        responses: {
          200: ok(fields({
            events: arr(fields({
              kind: str('log | gap'),
              chainId: int(),
              address: str(),
              blockNumber: int(),
              detectedAt: str(),
            })),
          })),
          400: error('400', 'invalid_limit.'),
        },
      },
    },

    '/ops/summary': {
      get: {
        tags: ['Ops'],
        summary: 'Operator dashboard snapshot',
        description:
          `Sections assemble with Promise.allSettled — a failing section degrades to `
          + `{error: "unavailable"} for that key only, never a 500. Rate limit 6/min · `
          + `burst 3. ${AUTH_OPT_IN}`,
        operationId: 'getOpsSummary',
        responses: {
          200: ok(fields({
            meta: fields(
              { version: str(), uptimeSeconds: int(), timestamp: str() },
              'Process-local facts that cannot fail.',
            ),
            storage: fields({
              mainDbBytes: int(),
              perChainDbFiles: arr(fields({ chainType: str(), name: str(), chainId: int(), bytes: int(), mtime: str() })),
              solcCache: fields({ files: int(), bytes: int() }),
            }),
            indexing: fields({ total: int(), chains: arr(fields({ chainId: int(), statuses: fields({}), total: int() })) }),
            watch: fields({ total: int(), subscriptions: arr(fields({ chainId: int(), address: str(), webhookConfigured: bool() })) }),
            rateLimit: fields({}, 'Per-bucket hits/rejected totals — no per-client data'),
            deepScan: fields({ total: int(), byStatus: fields({}) }),
          })),
        },
      },
    },

    '/sql/query': {
      post: {
        tags: ['SQL Console'],
        summary: 'Run a read-only query against the explorer\'s DuckDB',
        description:
          `Single statement only, must start with SELECT/WITH; DML/DDL/attach keywords `
          + `rejected anywhere. Capped at 500 rows (truncated: true beyond); cells `
          + `normalized for JSON. Rate limit 6/min · burst 3. ${AUTH_STRICT}`,
        operationId: 'querySqlConsole',
        requestBody: jsonBody(fields({
          sql: str('Required — the SQL text'),
        })),
        responses: {
          200: ok(fields({
            columns: arr(str(), 'Deduped DuckDB-style column names (a, a:1, …)'),
            rows: arr(arr(str(), 'Cell values normalized: bigint→string, Date→ISO UTC, binary→0x-hex')),
            rowCount: int(),
            truncated: bool(),
          })),
          400: error('400', 'invalid_query (message carries the real DuckDB error).'),
        },
      },
    },
    '/sql/tables': {
      get: {
        tags: ['SQL Console'],
        summary: 'Main-schema table browser',
        description: `Tables and column names from information_schema (schema main). ${AUTH_STRICT}`,
        operationId: 'listSqlTables',
        responses: {
          200: ok(fields({
            tables: arr(fields({ table: str(), columns: arr(str()) })),
          })),
        },
      },
    },

    '/chains/{chainId}/cached-data': {
      delete: {
        tags: ['Chains'],
        summary: 'Clear a chain\'s immutable fetch caches',
        description:
          `Drops cached contract sources and storage layouts only — they refetch on `
          + `demand. Event index databases, ranges, labels and watches are untouched. ${
            AUTH_OPT_IN}`,
        operationId: 'clearChainCachedData',
        parameters: [chainIdParam()],
        responses: {
          200: ok(fields({
            cleared: fields({}, 'Per-kind cleared counts'),
            scope: fields({
              cleared: arr(str()),
              untouched: str('What was deliberately left alone, as a sentence'),
            }),
          })),
        },
      },
    },
  },
};

// Serialize once at module scope: the document is a frozen-shape constant,
// so the handler only ever hands over the pre-rendered body.
const specJson = JSON.stringify(openApiDocument);

const app = new Hono();

// Open by design: the document leaks no secrets — it names paths. A
// generous cache lets local tools fetch it once per session.
app.get('/openapi.json', c => {
  c.header('Cache-Control', 'public, max-age=3600');
  c.header('Content-Type', 'application/json');
  return c.body(specJson);
});

export { specJson };
export default app;
