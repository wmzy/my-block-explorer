// Pure content model behind the /help section: the topic index, the
// keyboard-shortcut table, the data-sourcing glossary and the FAQ. Kept in
// one React-free module so the copy is unit-testable and so both help
// views (the /help index and the /help/:topic page) render the SAME
// model — a help section whose index and detail can disagree is worse
// than no help section at all.
//
// Honesty contract (the whole project's): every claim here must be
// checkable against shipped behavior. Where the app degrades, the help
// copy says so and names the fix; where a feature is a best-effort read
// of a provider, it says that too. No promise of completeness, no
// "all data" phrasing anywhere in this file.

/** A term/field row in a topic's reference table. */
export type HelpFact = {
  readonly label: string;
  readonly detail: string;
};

/**
 * A verbatim error string paired with what it actually means — the shape
 * a reader arrives with, quoted exactly as the provider emits it so
 * search-in-page finds the same text they pasted.
 */
export type HelpQuote = {
  readonly text: string;
  readonly detail: string;
};

/** A help topic as shown on the index and resolved by /help/:topic. */
export type HelpTopic = {
  /** URL segment under /help. The route's :topic param. */
  readonly slug: string;
  /** The heading the page renders (and the nav/palette label). */
  readonly title: string;
  /** One line, shown on the index card and as the page's subtitle. */
  readonly summary: string;
  /** The detail, one string per paragraph. */
  readonly body: readonly string[];
  /** The interactive surface this topic is about, for the "where to find it" line. */
  readonly where: string;
  /** Verbatim error strings and their meanings, rendered as a definition list. */
  readonly quotes?: readonly HelpQuote[];
  /** A reference table (the /api/health field meanings), with its own heading. */
  readonly table?: {
    readonly title: string;
    readonly intro?: string;
    readonly rows: readonly HelpFact[];
  };
};

export const HELP_INDEX_TITLE = 'Help';
export const HELP_INDEX_SUBTITLE =
  'How this explorer works, what its data means, and how to get the most out of it.';

/**
 * The section's share blurb (og:description / twitter card). Kept here so
 * the index page and the pure meta derivation (src/utils/metaDescribe.ts,
 * which the server-side og middleware evaluates) can never word it
 * differently.
 */
export const HELP_SECTION_DESCRIPTION =
  'How this explorer works and what its data means: getting started, navigation and shortcuts, addresses, contracts, tokens, storage, RPC and backend settings, a glossary and an FAQ.';

/** Troubleshooting first: it is the topic people arrive with a symptom for. */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    summary:
      'Backend not found, RPC provider limits, missing archive state, private txpools and dev-chain resets.',
    body: [
      'The "Backend not found" banner means the frontend probed localhost:8201–8205 for a local API server and none answered. Nothing is broken: pages that read live chain data (blocks, transactions, balances, charts) keep working straight from the chain’s RPC in your browser. What stays gated is everything that lives in the backend’s own database — search, cached contract sources, event indexing, labels, watch subscriptions.',
      'Start the backend and it is discovered automatically on any of the probed ports. The banner’s Open setup panel carries the command, a manual backend URL field for shared deployments, and a retry that keeps re-probing. Three run modes are supported: RPC-only, local backend, shared deployment.',
      'Public RPC endpoints are shared infrastructure and every provider draws its limits differently. The symptoms below are the ones this explorer’s error paths surface, what it already does about them, and the fix that remains on your side.',
      'Every one of those has an honest degraded state rather than an empty list presented as the truth — partial coverage is labelled as partial. The fixes are on the provider side: point the chain at an archive-mode RPC, a node you control, or a provider tier that serves the endpoints you need (⚙️ RPC settings in the top bar).',
      'Resetting a local dev chain (anvil, Hardhat) wipes the chain’s history but keeps its chain id, so previously cached verified sources and storage layouts may be stale. The chain home page detects the head going backwards and offers one-click clearing of that chain’s cached data. Chains viem does not ship — a private geth node, a new L2 — resolve once registered through Add chain in the chain selector, or the "Connect this chain via RPC" card on the chain’s own page.',
      'To check a backend by hand, curl http://localhost:8201/api/health. "status: ok" only means the process replied; it says nothing about RPC reachability or data coverage. The Ops dashboard has a Copy diagnostics button that builds a JSON snapshot for bug reports, and the repository’s issue templates ask for that payload plus /api/health, the run mode and the RPC provider class.',
    ],
    where: 'The banner on any page, the ⚙️ RPC settings modal, and the Ops dashboard.',
    // Verbatim provider/error strings: the text a reader pastes in, next
    // to what it means and what to do. Absorbed from the standalone
    // troubleshooting page this topic replaces.
    quotes: [
      {
        text: 'block range too large / results exceed limit',
        detail:
          'Public log endpoints cap how many blocks one eth_getLogs call may span, and every provider draws the line differently. This explorer mitigates it — scans chunk adaptively and each provider’s ceiling is remembered — and reports partial coverage with its badge when a scan still cannot finish inside its budget. Widen the window, or use a keyed endpoint to go further.',
      },
      {
        text: 'historical state … not available / missing trie node / pruned',
        detail:
          'Non-archive nodes discard old state, so balance-history charts and address deep scans — which read balances at past blocks — fail once they reach the pruned range. Point the chain at an archive-mode RPC (⚙️ RPC settings); most providers offer archive endpoints on a free or paid tier.',
      },
      {
        text: 'The Pending page shows an unsupported card',
        detail:
          'That card is the honest answer, not a bug: most public RPCs keep their transaction pool private and do not expose the txpool endpoints. To see pending transactions, use a node you control — or a provider tier that serves txpool content — as the chain’s RPC.',
      },
      {
        text: 'Call Trace / Internal Txns render as unavailable',
        detail:
          'Traces need debug_traceTransaction, which most public RPCs disable. The page degrades honestly — the transaction itself still renders — and lights up once the chain’s RPC serves debug methods (a self-run node with the debug API enabled, or a provider tier that includes it).',
      },
      {
        text: 'HTTP 429 responses',
        detail:
          'Rate limiting: shared free endpoints throttle bursts, and 429 bodies carry a Retry-After the explorer honors by backing off. Occasional 429s are normal on public endpoints; constant ones mean the endpoint is saturated for your usage — register a provider API key (⚙️ RPC settings) or use your own node.',
      },
    ],
    table: {
      title: 'What /api/health answers with',
      intro:
        'curl http://localhost:8201/api/health returns five fields. None of them reports data coverage — for that, read the coverage badge on the page you are looking at.',
      rows: [
        {
          label: 'status',
          detail:
            '"ok" means the process answered at all. It says nothing about RPC reachability or data coverage.',
        },
        {
          label: 'adminTokenConfigured',
          detail:
            'Whether the server has ADMIN_TOKEN set. true: admin-gated writes require the x-admin-token header (fill it in under ⚙️ RPC → Admin token). false: zero-config local mode — those writes pass through.',
        },
        {
          label: 'debugApiEnabled',
          detail:
            'Whether the raw-SQL debug API is mounted (ENABLE_DEBUG_API=1). Expected false; the server refuses to start with it enabled on a public bind.',
        },
        {
          label: 'version',
          detail:
            'The backend’s version. Compare it against the frontend’s: a hosted frontend and an npx-started backend follow independent release lines and can be out of sync — build both from the same source if they disagree.',
        },
        {
          label: 'timestamp',
          detail: 'The server’s clock at answer time — a quick skew check for log correlation.',
        },
      ],
    },
  },
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary:
      'Pick a network, find an address or transaction, understand the three run modes, and know what needs the backend.',
    body: [
      'Pick a network with the chain selector in the top bar. Almost every viem-supported chain works out of the box; anything viem does not ship (a private geth node, a brand-new L2, a chain still missing upstream) can be registered once under Add chain — the registered RPC then serves every page on that chain. The ten most-used networks get a curated default RPC; the rest fall back to viem\u2019s public endpoint, which can be rate-limited or offline.',
      'Find things three ways. The top-bar search box takes an address, a transaction hash or a block number, plus ENS names (resolved in your browser against a mainnet RPC — you choose which chain to open the result on before it navigates). A free-text query — a token symbol, a contract name, a label you saved — goes to the backend index, so it needs a running backend. Everything else is a direct link: /address/0x…, /tx/0x…, /block/12345.',
      'The three run modes decide what the app can do. RPC-only needs nothing installed and stores nothing, so search, cached sources and event indexing are unavailable. A local backend gives the full feature set and keeps its data under the data/ directory next to where you started it. A shared deployment serves many browsers from one backend, where ADMIN_TOKEN and the CORS origin allowlist become the knobs that matter.',
      'Start the backend with the command the setup panel shows: npx my-block-explorer --port 8201. It is discovered automatically on ports 8201–8205. To point the frontend at a backend running elsewhere, use the manual URL field in the same panel — the choice is remembered per browser.',
      'What needs the backend, plainly: the search index, cached contract sources and storage layouts, event indexing and its statistics, address labels, the watchlist\u2019s server-side subscriptions, the SQL console and the Ops dashboard. What does not: blocks, transactions, balances, nonces, contract reads and simulations, token metadata, charts, storage values, the command palette, and every page in this help section.',
      'Keyboard: press Ctrl/Cmd+K anywhere for the command palette, which lists every page and tool. The Tools page is the same list without a keyboard.',
    ],
    where: 'The first-run guide at the landing page, plus the chain selector and the search box.',
  },
  {
    slug: 'navigation',
    title: 'Navigation & shortcuts',
    summary: 'The command palette, the top-bar pages, the URL parameters pages honor, and where the settings live.',
    body: [
      'The command palette (Ctrl/Cmd+K on Windows and Linux, ⌘K on macOS) opens on any page. Type to filter by page name or keyword — "mempool" finds Pending, "topic0" finds Signatures, "duckdb" finds the SQL console — then ↑ ↓ to move and Enter to open. Esc closes it. It is hidden on narrow screens; the Tools page and the top-bar links cover the same ground by touch.',
      'The top bar carries the search box, the palette trigger, the theme toggle, the ⚙️ RPC settings button, the chain selector, and a link row: Blocks, Transactions, Pending, Broadcast, Contracts, Tokens, Charts, Tools and Help. SQL and Ops sit after them behind a divider, because they are operator surfaces.',
      'Pages keep their state in the URL, so anything you are looking at is shareable and survives a reload. Chain pages take ?chain= and the family-specific parameters; the contract page takes ?tab= (source, abi, interact, events, storage), ?refresh= and ?revoke=; the address page takes ?tab=, ?page=, ?window=, ?ttPage=, ?ttWindow=, ?balanceHistory= and the transaction filter fields; the search page takes ?q= and ?chain=; the storage explorer takes ?sv=. When a page parameter is out of range, the URL converges to the nearest valid value rather than showing an empty page.',
      'Settings live in the ⚙️ RPC modal: per-chain RPC endpoints, custom chains, the admin token (stored in this browser and sent as a header), the IPFS gateway, and backup & restore. Theme preference (Light / Dark / System) follows the OS by default and is remembered once you pick.',
      'Switching chains from the selector keeps you on the equivalent page when one exists (an address, a transaction or a block opens on the same entity on the new chain) and lands on the chain home otherwise. When an entity is chain-specific and the target chain has never seen it, you get an honest not-found state, not a silent redirect to a different entity.',
    ],
    where: 'Ctrl/Cmd+K anywhere; the top-bar link row; every page\u2019s own URL.',
  },
  {
    slug: 'addresses',
    title: 'Addresses & transactions',
    summary:
      'Balances and nonces, what the transaction history really covers, the activity tabs, and honest partial data.',
    body: [
      'Balance and nonce are read live from the chain on every visit, not from a cache, so they match the chain head. The label "Outgoing Transactions (Nonce)" is exact: a nonce counts outgoing transactions only, so a nonce of 5 with 200 incoming transfers is normal.',
      'The Transactions tab is discovered, not indexed. The explorer finds transactions by walking blocks and watching for changes in the address\u2019s balance, which means the list is complete only within the block window it walked. The page says so: the coverage badge names the window and the reason, and partial coverage reads "At least N transactions discovered" rather than a total. Widen the window with the depth control, or run a deep scan to walk from genesis in the background — a completed deep scan is the one case where the app can honestly claim complete coverage, and it only says so when the walk actually started at block 0.',
      'Token Transfers is a separate on-demand scan of ERC-20, ERC-721 and ERC-1155 Transfer events, filtered by direction and by the standard. It is cached for about a minute; Refresh re-scans. "Search deeper" widens the block range. An empty result is never proof of absence: when the contract is one this app has not indexed, the tab offers to start indexing its events.',
      'Internal Txns traces the first transactions of the current window with the node\u2019s call tracer and lists value-moving and address-matching frames. It needs debug_traceTransaction, so most public RPCs render an honest "not supported" state. Deep-scan records appear in their own section, covering the blocks where a balance change was found rather than every block.',
      'Also on the page: approvals (grouped token/spender pairs with live allowances, plus the history of what was approved), discovered token holdings, known tokens with live balances, private notes stored only in this browser, an address QR code, and a label you can edit inline. All of them are window-limited or best-effort and each carries its own caveat.',
    ],
    where: 'Any address page — the top bar takes an address or ENS name straight to it.',
  },
  {
    slug: 'contracts',
    title: 'Contracts & interacting',
    summary:
      'Source and ABI, the five contract tabs, reading state, simulating calls, and sending with a wallet.',
    body: [
      'A contract page has five tabs: Source, ABI, Interact, Events and Storage. Verified contracts show the decompiled source and the ABI as published by the verification service. Unverified ones are not dead ends: the Interact tab works from any ABI you paste yourself, and the page links to the verification service and to a local compile check that recompiles the source with the pinned solc version and compares bytecode.',
      'Interacting: pick a function, fill the arguments, and choose read (a call returning a value), simulate (a call with no state change, with balance and gas estimation), or — when your browser has an injected wallet — send with wallet. Calls are decoded against the contract\u2019s ABI; a revert is decoded into its custom error or panic code when the ABI is known, and shown raw when it is not.',
      'A trailing run of parameters can be left empty only when the ABI itself carries an overload with that exact name and argument count — the copy and wallet paths refuse the same state, so a command can never encode a signature the contract does not have. Advanced: state overrides let a simulation pretend a storage slot or an account balance is different, without touching the chain.',
      'Copy as cast or copy as viem produces a runnable command for whatever you built: an address placeholder, an argument list in the contract\u2019s own types (never a JSON string), and the chain the explorer is actually using. The ABI tab can copy just the entries you select, always including every error definition so that pasted fragments still decode reverts.',
      'Events shows only what has been indexed for this contract — start indexing from the Events tab, pick a range, and the progress, the CSV export and the statistics follow. Storage is a column explorer over the layout: drill mappings and arrays, and each value is read from the chain as you go (from the implementation when the contract is a proxy, which the page states).',
    ],
    where: 'Any contract address — or the Contracts directory for the ones this explorer has cached.',
  },
  {
    slug: 'tokens',
    title: 'Tokens & prices',
    summary:
      'The token directory, per-token pages, USD prices, NFT metadata, and how much of it is curated versus discovered.',
    body: [
      'The token page is a lens over a contract address: an overview read in one multicall batch (name, symbol, decimals, total supply), the transfers of that token, top holders, and mint/burn totals. It is honest about what it found — a contract that answers neither decimals nor supply is shown as a standard-unknown contract, possibly an NFT, rather than being claimed as an ERC-20.',
      'USD prices come from a public price API, keyed by chain and token address, cached in this browser for a minute. Where a price is unavailable, the row shows the raw amount and says so instead of rendering a zero. Sub-cent values widen their precision rather than rounding to "$0.00", because a rounded-to-zero price is information-free. Token pages can also show a price history sparkline when the API has one.',
      'NFT items are derived from the same transfer scan: ERC-721 ids and ERC-1155 net amounts, with metadata resolved from the token URI when a gateway can read it. Metadata that fails versus metadata that cannot be fetched are two different states: the first is remembered for an hour, the second is retried. The gateway is configurable in the settings modal.',
      'The token directory lists curated well-known tokens per chain plus the tokens you have opened in this browser, priced where the price API resolves them. It is explicitly not a registry: the directory cannot know every token on a chain, and the page says so.',
      'Top holders, holdings and transfer counts are all netted from scanned transfers, so they are as complete as the window that produced them. Each of those figures carries a "may be incomplete" note, and mint/burn totals mark the zero-address flows so a burn is not read as a transfer to a user.',
    ],
    where: 'The Tokens link in the top bar, and any contract address that turns out to be a token.',
  },
  {
    slug: 'storage',
    title: 'Storage & raw data',
    summary:
      'The storage column explorer, what every row can copy, raw JSON for blocks and transactions, and what is decoded.',
    body: [
      'The Storage tab is a column explorer over the contract\u2019s storage layout: a column per level of the path you drilled. Mappings take a key (validated in the field), arrays paginate, structs expand member by member. A dynamic array reads its length from the slot the layout says, not from a guess; a long string or byte array is sliced from the high-order bytes where Solidity stores it.',
      'Every column header carries its slot in hex plus runnable commands: a viem snippet (a readContract or getStorageAt call) and a cast storage command. Every member row carries its own viem read, so you can copy the code for a single value without drilling to it. For a proxy, values are read from the implementation and the page says which address was read.',
      'The layout comes from a verification service or a storage-layout fetcher and is cached forever, because a layout cannot change after compilation. If your source differs from the deployed bytecode, the layout shown is the one for the deployed contract.',
      'Raw JSON is available on blocks and transactions — the block (with or without its transactions), the transaction and its receipt, event logs, and failed-call data — each section collapsible, copyable, and independently retryable. Token transfers in a transaction are decoded from the logs themselves (no ABI needed) for the standard Transfer shapes, and EIP-7702 authorizations, EIP-4337 user operations and Safe multisig calls are decoded where the calldata and logs allow it.',
    ],
    where: 'A contract page\u2019s Storage tab, and the Raw JSON card on any block or transaction.',
  },
  {
    slug: 'rpc-settings',
    title: 'RPC & backend settings',
    summary:
      'Per-chain endpoints, custom chains, the admin token, the two admin tiers, and what the server will not do.',
    body: [
      'Every chain has its own RPC endpoint. Editing it in the ⚙️ RPC modal takes effect for the browser immediately and for the backend on its next request. Recommended public nodes are listed per chain; a keyed endpoint is the reliable way past the rate limits of a shared one. Removing a custom endpoint falls back to the built-in default, which is why "it got slower" sometimes follows an edit.',
      'Custom chains: any EVM chain viem does not ship can be registered with a chain id, a symbol and an RPC URL, which is probed once with eth_chainId before it is stored. Built-in viem networks cannot be shadowed — registering a real mainnet id as a private chain is refused.',
      'Two admin tiers, both on the backend. Read-only queries are open. Writes that change your data — RPC config writes, event indexing, watch subscriptions, cache clears — pass through when the server has no ADMIN_TOKEN set (the zero-config local default) and require the x-admin-token header when it does. The SQL console is the strict exception: it never runs without a token, and the token is entered once in the settings modal and remembered in this browser.',
      'The backend also reads a few environment variables: the bind address (loopback unless you set it otherwise), the CORS origin allowlist, the rate limits, the admin token, the database location, and the optional debug-SQL flag — which the server refuses to start with on a public bind unless you also set an explicit allow flag. /api/health reports what is configured.',
      'Only the explorer\u2019s own data is stored: contract sources, storage layouts, indexed events, labels, custom chains, RPC configuration and watch subscriptions in DuckDB under data/; your watchlist, theme, IPFS gateway, custom ABIs and private notes in this browser. Nothing is sent to a third party except the chain RPCs you configured, the price API, the verification services and — if you configure it — a webhook you own. Backup & restore in the settings modal exports labels, custom chains and every browser preference to one JSON file, with an honest note per part that could not be read.',
      'Uninstall: the CLI has an uninstall command that lists exactly what it would delete (the main database, per-chain event databases, the compiler cache and a scratch directory), shows sizes and the absolute path, and refuses to run while a server still answers on the discovery ports.',
    ],
    where: 'The ⚙️ RPC button in the top bar, and the /api/health endpoint.',
  },
];

const topicBySlug = new Map(HELP_TOPICS.map(topic => [topic.slug, topic]));

/** The topic for a :topic segment, or undefined for an unknown one. */
export function findHelpTopic(slug: string | undefined): HelpTopic | undefined {
  if (slug === undefined) return undefined;
  return topicBySlug.get(slug);
}

/** The topics a sibling topic page should offer, excluding itself. */
export function relatedHelpTopics(slug: string): HelpTopic[] {
  return HELP_TOPICS.filter(topic => topic.slug !== slug);
}

// --- Keyboard shortcuts ---

export type Shortcut = {
  readonly keys: string;
  readonly action: string;
  /** Platforms the spelling differs on; absent when it does not. */
  readonly macNote?: string;
};

export const KEYBOARD_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Ctrl+K / ⌘K', action: 'Open the command palette' },
  { keys: '↑ / ↓', action: 'Move through the palette results' },
  { keys: 'Enter', action: 'Open the highlighted palette result' },
  { keys: 'Esc', action: 'Close the palette, the chain filter or a history dropdown' },
  { keys: 'Enter', action: 'Run the top-bar search, or confirm the highlighted chain' },
  { keys: 'Enter', action: 'Activate a button-shaped row (labels, anchors, storage keys)' },
];

// --- Glossary ---

export type GlossaryTerm = {
  readonly term: string;
  readonly meaning: string;
};

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: 'Backend',
    meaning:
      'The Node process that serves the cached data — search, verified sources, indexed events, labels — and the admin surfaces. Started with npx my-block-explorer; discovered automatically on ports 8201–8205.',
  },
  {
    term: 'RPC',
    meaning:
      'The JSON-RPC endpoint a chain is read through. Live data (blocks, balances, contract calls) comes from whatever endpoint the chain is configured with, in your browser or in the backend.',
  },
  {
    term: 'Nonce',
    meaning: 'The account\u2019s outgoing-transaction counter. It does not count incoming transfers, which is why a large token history can sit next to a small nonce.',
  },
  {
    term: 'Finalized / Safe',
    meaning:
      'A block the chain\u2019s consensus considers settled. A transaction in a finalized block will not be reorganized out; recent blocks can still be.',
  },
  {
    term: 'Calldata',
    meaning:
      'The bytes a transaction carries as its input: a 4-byte selector plus ABI-encoded arguments. This explorer decodes them against a contract\u2019s ABI where it has one.',
  },
  {
    term: 'Storage layout',
    meaning:
      'The map of a contract\u2019s storage slots to variables. It is fixed at compile time, which is why a verified layout is cached permanently.',
  },
  {
    term: 'Gwei',
    meaning: 'One billionth of a native token. Gas prices are quoted in gwei; the value unit switcher on transaction and contract pages changes what amounts are displayed in.',
  },
  {
    term: 'Custom chain',
    meaning:
      'An EVM network viem does not ship, registered by you with a chain id and an RPC URL. It then behaves like any other chain in every page.',
  },
  {
    term: 'Coverage badge',
    meaning:
      'The chip that says how a number was obtained — live, cached, discovered, sampled, partial or unavailable. Its expanded detail explains the level in plain words; the full vocabulary is on the data coverage page.',
  },
  {
    term: 'Deep scan',
    meaning:
      'A background walk from the first block forward, recording every transaction of an address. It is the only path that can honestly report complete address coverage, and only when the walk started at block 0.',
  },
  {
    term: 'Call trace',
    meaning:
      'The internal call tree of a transaction, from the node\u2019s debug tracer. Not every RPC endpoint offers it; where it is missing, the page says so instead of showing an empty tree.',
  },
  {
    term: 'Watch subscription',
    meaning:
      'A server-side watch of an address for incoming activity, with an optional webhook. It runs only while the backend is running, and only from the point you subscribed — it is not a historical lookup.',
  },
];

// --- FAQ ---

export type FaqEntry = {
  readonly question: string;
  /** One string per paragraph. */
  readonly answer: readonly string[];
};

export const FAQ: readonly FaqEntry[] = [
  {
    question: 'Do I need the backend?',
    answer: [
      'No. With nothing but an RPC endpoint, blocks, transactions, balances, contract reads, token metadata, charts, storage values and this help section all work.',
      'A backend adds the search index, cached contract sources, event indexing, labels, server-side watch subscriptions, the SQL console and the Ops dashboard. The app tells you which is which at the banner rather than failing silently.',
    ],
  },
  {
    question: 'Is this a full block explorer?',
    answer: [
      'It is a lightweight, local-first explorer: it reads live data from whichever RPC you configure and keeps a small local cache of the immutable things (verified sources, layouts) and what you asked it to index.',
      'That is a different trade from a full indexer, and the interface says so everywhere it matters — coverage badges on every page, "discovered" instead of "complete" where a window is in play, and a page describing exactly how the two differ.',
    ],
  },
  {
    question: 'Why is a number different from another explorer?',
    answer: [
      'Most often because of the window: this explorer scans a range you can see and widen, where an indexer has everything from genesis. Sometimes it is the data source: a live RPC call versus an index, or a non-archive node that cannot answer for an old block.',
      'The coverage badge on the page tells you which of the two it is in each case, and the data coverage page explains every level.',
    ],
  },
  {
    question: 'Does anything I type leave my machine?',
    answer: [
      'Queries go to the chain RPCs you configured, to the price API for USD values, to the verification services for sources and layouts, and to the signature lookup for method names. Nothing is sent anywhere else.',
      'Your watchlist, theme, IPFS gateway, custom ABIs and private notes never leave this browser — they are not stored on the backend at all, and backup & restore exports them to a file you control.',
    ],
  },
  {
    question: 'How do I get complete transaction history for an address?',
    answer: [
      'Start a deep scan on the Transactions tab. It walks blocks from the earliest one in the background, reports progress, and can be paused, resumed or deleted.',
      'It takes a long time on a large chain — the page says that up front, and the ETA it shows is an estimate from its own progress, not a promise. A finished scan started at block 0 is the one case where this explorer reports complete coverage.',
    ],
  },
  {
    question: 'Can I run this for other people?',
    answer: [
      'Yes — a shared deployment is one of the three supported run modes. Set the bind address, set an admin token, and set the CORS allowlist to the origins you serve; the server warns on startup if a public bind has no admin token, and refuses the debug-SQL flag on a public bind entirely.',
      'The exact variables are in the deployment guide; nothing else needs to change.',
    ],
  },
];
