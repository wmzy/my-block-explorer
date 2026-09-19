# Chain switching

How the explorer handles multiple chains. The code is the source of truth;
everything below is verifiable in the cited files. For the wider navigation
story (typed links, search routing, the RPC modal) see
[NAVIGATION.md](./NAVIGATION.md).

## The model: the chain lives in the URL

There is no global chain state and no React Router. Routing is one **flat
`createRoutes` table in `src/views/index.tsx`** (`@native-router/react`),
and every data page is scoped by a `/chain/:chainId` prefix:

| Path | View |
| --- | --- |
| `/` | `Home/Landing` — redirect-only (see below) |
| `/chain/:chainId` | `Home` |
| `/chain/:chainId/blocks` | `Blocks/List` |
| `/chain/:chainId/transactions` | `Transactions/List` |
| `/chain/:chainId/block/:blockNumber` | `Blocks/Detail` (numbers only, not hashes) |
| `/chain/:chainId/tx/:txHash` | `Transactions/Detail` |
| `/chain/:chainId/address/:address` | `Address` |
| `/chain/:chainId/contract/:address` (+ `/events`) | `Contract` |

Because the chain is a route param, a deep link is unambiguous, shareable
and reload-safe; switching chains is *just a navigation*, nothing is torn
down or re-bootstrapped. The router's base URL derives from
`import.meta.env.BASE_URL`, so on the GitHub Pages subpath deploy all of
these gain the `/my-block-explorer/` prefix.

## Supported chains

`src/config/chains.ts` — `SUPPORTED_CHAINS = Object.values(chains)` from
`viem/chains`: **every chain viem defines works, with no per-chain
registration**. In the pinned viem version that is 732 exports deduped to
704 unique chain ids (the picker dedupes by id — several exports are aliases
or testnet twins of one id).

- `POPULAR_CHAINS` pins 10 chains (mainnet, Polygon, BSC, Arbitrum, Base,
  Optimism, Avalanche, Fantom, Celo, Gnosis) at the top of the picker,
  marked ⭐.
- Testnets get a badge (`getChainType`).
- "Supported" means exactly `isChainSupported(id)` — an id lookup in that
  set; a viem upgrade is what adds chains.

## Landing and the remembered chain

`/` is the redirect-only `Landing` view (`src/views/Home/Landing.tsx`). At
mount it replaces the URL with:

1. the **last chain the user actually viewed**, if still a supported id —
   persisted in localStorage under `be:lastChainId`
   (`LAST_CHAIN_STORAGE_KEY`), written by the Home view via
   `rememberChainId()` whenever a valid chain renders;
2. else the **preferred chain** — mainnet when supported, else the head of
   the sorted chain list (`getPreferredChainId()`);
3. else `/chain/1` as the dead-last fallback.

## Switching chains

Every view mounts `TopNavigation` and passes it a `handleChainChange` that
calls `redirectReplace` (exported from `src/views/Home/Landing.tsx`:
`preload` + `commitReplace`, i.e. navigate-with-replace semantics) — chain
hops replace the current history entry instead of piling new ones.
Preservation of the entity param is decided per view:

| From | Goes to | Rationale |
| --- | --- | --- |
| Home | `/chain/:newId` | the new chain's home |
| Blocks list | `/chain/:newId/blocks` | lists carry no params worth keeping |
| Transactions list | `/chain/:newId/transactions` | same |
| Address page | `/chain/:newId/address/:address` | an address is chain-agnostic |
| Contract page | `/chain/:newId/contract/:address` | the address is chain-agnostic; the `/events` subpath is not preserved — the view lands on its default tab |
| Tx detail | `/chain/:newId/tx/:hash` | the hash is chain-agnostic; re-resolves this exact tx on the target chain's RPC |
| **Block detail** | **`/chain/:newId`** (chain home) | **the exception**: a block *number* is not a chain-agnostic identity — the same number on another chain is a different block with different data, so keeping it would silently show unrelated data. The user re-picks a block there. |
| Search page | no navigation | re-runs the current query on the new chain; with no query, the chain becomes the context for the next search (`handleNavChainChange` in `src/views/Search/index.tsx`) |

## Unsupported chain deep links

A deep link like `/chain/999999` does **not** silently redirect to some
other chain. Views render `UnsupportedChainState`
(`src/views/Home/UnsupportedChainState.tsx`): an explicit "no configuration
for chain ID X" error plus two **deterministic** recovery CTAs —

- *"Go to Mainnet"* (or the preferred chain) — deliberately **not** the
  viewer's remembered chain, so a shared link behaves identically for every
  visitor;
- *"Open chain list"* — the `/` landing route, where the redirect and the
  chain selector offer the full list.

## The chain selector UI

`ChainSelector` (inside `src/components/TopNavigation.tsx`, top-right):

- shows the current chain name (+ Testnet badge);
- type-over filter — `searchChains()` matches name or chain id, with a
  "Found N chains · Press Enter to select first" hint;
- keyboard: `Enter` picks the first filtered match, `Escape` closes;
- entries show `ID • native symbol`, ⭐ for `POPULAR_CHAINS`, testnet
  badges; the list comes from `getSortedChains()` (sorted by type and
  popularity, deduped by id).

## Adding a chain

There is nothing to add per chain: every `viem/chains` export is already
supported, and new chains arrive with viem upgrades. If you want a chain
pinned at the top of the picker, add it to `POPULAR_CHAINS` in
`src/config/chains.ts`.
