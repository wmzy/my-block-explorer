# Navigation

How routing and user navigation actually work in this app. The code is the
source of truth; everything below is verifiable in the cited files.

## Routing: flat `@native-router` table

There is no React Router and no nested routing. `src/views/index.tsx` defines
one flat `createRoutes` table where each route maps directly to a lazily
imported view:

| Path | View |
| --- | --- |
| `/` | `Home/Landing` — redirect-only (see below) |
| `/chain/:chainId` | `Home` |
| `/chain/:chainId/blocks` | `Blocks/List` |
| `/chain/:chainId/transactions` | `Transactions/List` |
| `/chain/:chainId/block/:blockNumber` | `Blocks/Detail` (numbers only, not hashes) |
| `/chain/:chainId/tx/:txHash` | `Transactions/Detail` |
| `/chain/:chainId/address/:address` | `Address` |
| `/chain/:chainId/contract/:address` | `Contract` |
| `/chain/:chainId/contract/:address/events` | `Contract` (same view, Events tab default) |
| `/search` | `Search` |

- The two contract routes attach `data: contractSourceLoader` with a skeleton
  `pendingComponent` — contract source is immutable, so it resolves during
  navigation and the view's hook serves the loader-primed cache entry.
- The router's base URL is derived from `import.meta.env.BASE_URL`, so the
  GitHub Pages subpath deploy (`VITE_BASE=/my-block-explorer/`) matches
  navigation correctly.

### Typed links and params

`src/views/index.tsx` exports `AppPaths` (a literal union of every route
path). `TypedLink<AppPaths>` narrows its `to` prop against that union, so a
path typo or an incomplete `params` object fails at compile time. Views read
route params with `useMatched()` and query params with `useSearch(schema)`
(e.g. the transactions list filters by `?block=`).

## Chain context

The chain is part of the URL (`/chain/:chainId/...`) — no global chain state.
The last chain the user actually viewed is persisted in localStorage under
`be:lastChainId` (`LAST_CHAIN_STORAGE_KEY` in `src/views/Home/Landing.tsx`;
written by the Home view via `rememberChainId()`).

`/` is a redirect-only Landing view: at mount it `redirectReplace`s to the
remembered chain if it is still a supported chain id, else the preferred
chain from the sorted chain config, else `/chain/1`.

## Chain switching

Every view mounts `TopNavigation` and passes it a `handleChainChange` that
calls `redirectReplace` (from `src/views/Home/Landing.tsx` — `navigate` with
replace semantics, so no history entry is pushed) to the same page on the new
chain, preserving the entity param where one exists:

- `/chain/1/address/0x…` → `/chain/137/address/0x…`
- `/chain/1/contract/0x…` → `/chain/137/contract/0x…`
- `/chain/1/tx/0x…` → `/chain/137/tx/0x…`
- `/chain/1/block/123` → `/chain/137/block/123`
- list pages → the same list on the new chain; unknown chain ids bounce back
  to the landing target

## Search bar (`src/components/TopNavigation.tsx`)

One dispatcher (`navigateForQuery`) sanitizes the input and classifies it
with the shared `utils/validation` helpers (the same pair every other search
surface uses):

- **Address** → deep-links straight to `/chain/:chainId/address/:address` on
  the current chain.
- **Block number** → deep-links straight to the block page (numbers only).
- **Hash** → goes through the chain-scoped search API
  (`GET /api/chains/:chainId/search`, via the discovered API base — never a
  raw same-origin fetch) to decide tx vs. block-hash; a block hash lands on
  the block page by number.
- **ENS name** → resolved **client-side against a mainnet client**
  (`createRpcClient(1)` — the ENS registry only exists on mainnet, so the
  lookup target never changes with the viewed chain); the resolved address is
  then viewed on the *current* chain, and every ENS surface labels the result
  "resolved on Ethereum". "Name not found" (definitive) and "resolution
  failed" (RPC did not answer — offers Retry) are distinct outcomes.
- **Anything else** → `/search?q=…&chain=…` so the global search endpoint
  searches the current chain and its suggestions link back to that chain.
  After a search resolves, `/search` writes the resolved chain back into the
  URL and renders a "Searched on {chain}" line, so deep links are
  shareable and unambiguous.

Inline notices under the box distinguish a definitive miss, a degraded
(data-source errored) response, and ENS resolved/failed outcomes. Focusing
the box shows the **per-browser history dropdown** — entries live in
localStorage (`be:searchHistory`, max 10, never sent to or read from the
server) with a Clear button and per-item removal; a history entry re-runs
on the chain it was recorded on.

## RPC settings modal (`src/components/RpcConfig.tsx`)

Opened from the **⚙️ RPC** button in `TopNavigation`, and from the
"configure RPC" action of `RpcFunctionError` on contract pages.

- **Reads are open**: the modal loads the current override list via
  `GET /api/rpc-configs` without any token (the response carries endpoint
  URLs only, no secrets).
- **Test before save, client-side**: "Test connection" fetches
  `eth_chainId` / block history directly against the entered URL in the
  browser (chain-id match, history support, recommended event range) and
  blocks the save on failure.
- **Writes are opt-in gated server-side**: save/delete (`POST` /
  `DELETE /api/rpc-configs`) require the `x-admin-token` header only when the
  server has `ADMIN_TOKEN` set; a 403 surfaces a notice in the modal.
- The **"Admin token (stored in this browser)"** field persists the token in
  localStorage (`src/util/adminAuth.ts`); the HTTP layer attaches it to every
  request automatically.
