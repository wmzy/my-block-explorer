// Curated per-chain "known routers" for the transactions list's Method
// column (views/Transactions/methodColumn): when a transaction's
// to-address is one of these contracts, the row gets a small protocol
// chip ('Uniswap V3', …) beside the method name. ONE address list per
// POPULAR_CHAINS member, every entry corroborated on 2026-09-24 against
// official Uniswap Labs sources: the deployment pages of the Uniswap
// docs (fetched from the docs site's own source repo,
// github.com/Uniswap/docs content/protocols/…, which renders at
// docs.uniswap.org / developers.uniswap.org), the @uniswap/sdk-core
// address map (github.com/Uniswap/sdk-core src/addresses.ts — the
// production routing addresses app.uniswap.org trades through), and the
// universal-router repo's per-chain deploy-addresses JSON; every one of
// the 62 entries additionally passed an on-chain eth_getCode liveness
// check through a public RPC of its own chain (identical bytecode
// lengths across the deterministic same-address deployments, e.g. the
// multichain 0x4752… V2 Router02). Addresses the official sources could
// not corroborate ship no entry — never a guess.
//
// Honesty contract: the chip is a DISPLAY HINT ONLY marking the
// to-address as a well-known router contract. A row WITHOUT a chip is
// NOT "not a router" — it is merely uncurated (third-party routers,
// forks, and chains outside this list get no chip and no judgment).
// Addresses are stored EIP-55 checksummed; the lookup lowercases for
// comparison.

/** One curated router: contract address plus the protocol chip it earns. */
export type KnownRouter = {
  /** EIP-55 checksummed router address. */
  address: `0x${string}`;
  /** Machine-readable protocol id ('uniswap'); stable for future families. */
  protocol: string;
  /** Chip label shown next to the method name (display hint only). */
  label: string;
};

// Uniswap V2 Router02 labels: every V2-family router chips as
// 'Uniswap V2'.
const V2_LABEL = 'Uniswap V2';
// Both V3-family routers (the v1.0.0 periphery SwapRouter and the newer
// SwapRouter02) chip as 'Uniswap V3'.
const V3_LABEL = 'Uniswap V3';
// The Universal Router is version- and venue-agnostic (it routes V2/V3
// and NFT trades), so its chip is the plain protocol name.
const UR_LABEL = 'Uniswap';

// mainnet — V2 Router02 / V3 SwapRouter / SwapRouter02 from the docs'
// Ethereum deployments page, Universal Router versions (V1 through
// V2.1.2, all officially published; the list walks history, so rows
// targetting any era's router still chip) from the universal-router
// repo's mainnet.json. The docs' current UniversalRouter row (0x66a9…)
// is the repo's V2 entry.
// Sources: github.com/Uniswap/docs/blob/main/content/protocols/v2/deployments.mdx,
// github.com/Uniswap/docs/blob/main/content/protocols/v3/deployments/v3-ethereum-deployments.mdx,
// github.com/Uniswap/universal-router/blob/main/deploy-addresses/mainnet.json
const MAINNET: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Mainnet row).
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter (v3-periphery v1.0.0) — docs v3 ethereum deployments.
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', protocol: 'uniswap', label: V3_LABEL },
  // SwapRouter02 — docs v3 ethereum deployments + sdk-core.
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — universal-router repo mainnet.json.
  { address: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — mainnet.json.
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — mainnet.json; also the docs deployments row.
  { address: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — mainnet.json.
  { address: '0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — mainnet.json.
  { address: '0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85', protocol: 'uniswap', label: UR_LABEL },
];

// polygon — V2 Router02 from the docs v2 deployments table; V3 SwapRouter
// and SwapRouter02 (both at the same addresses as mainnet — deterministic
// deployments, confirmed per-chain by the docs' Polygon page, which also
// warns not to assume same-address across chains) and Universal Router
// versions from polygon.json.
// Sources: …/v2/deployments.mdx, …/v3-polygon-deployments.mdx,
// universal-router/blob/main/deploy-addresses/polygon.json
const POLYGON: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Polygon row).
  { address: '0xedf6066a2b290C185783862C7F4776A2C8077AD1', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter (v3-periphery v1.0.0) — docs v3 polygon deployments.
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', protocol: 'uniswap', label: V3_LABEL },
  // SwapRouter02 — docs v3 polygon deployments + sdk-core default.
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — polygon.json.
  { address: '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (no V2 support) — polygon.json.
  { address: '0x643770E279d5D0733F21d6DC03A8efbABf3255B4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — polygon.json.
  { address: '0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — polygon.json; also the docs deployments row.
  { address: '0x1095692A6237d83C6a72F3F5eFEdb9A670C49223', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — polygon.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — polygon.json.
  { address: '0xDc264714F68d84CF29BC605589405E78bDBE7C9f', protocol: 'uniswap', label: UR_LABEL },
];

// bsc — V2 Router02 (docs v2 table; the deterministic multichain 0x4752…
// deployment shared with Arbitrum/Avalanche/Base) and SwapRouter02 from
// the docs' BNB deployments page, Universal Router versions from
// bsc.json. The v3-periphery SwapRouter (V1) was never deployed here per
// the docs page (which lists no SwapRouter row) — no entry, no guess.
// Sources: …/v2/deployments.mdx, …/v3-bnb-deployments.mdx,
// universal-router/blob/main/deploy-addresses/bsc.json
const BSC: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (BNB Chain row).
  { address: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter02 — docs v3 bnb deployments + sdk-core BNB addresses.
  { address: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — bsc.json.
  { address: '0x5Dc88340E1c5c6366864Ee415d6034cadd1A9897', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (no V2 support) — bsc.json.
  { address: '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — bsc.json.
  { address: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — bsc.json; also the docs deployments row.
  { address: '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — bsc.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — bsc.json.
  { address: '0xDc264714F68d84CF29BC605589405E78bDBE7C9f', protocol: 'uniswap', label: UR_LABEL },
];

// arbitrum — V2 Router02 from the docs v2 table, V3 SwapRouter +
// SwapRouter02 from the docs' Arbitrum page, Universal Router versions
// from arbitrum.json.
// Sources: …/v2/deployments.mdx, …/v3-arbitrum-deployments.mdx,
// universal-router/blob/main/deploy-addresses/arbitrum.json
const ARBITRUM: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Arbitrum row).
  { address: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter (v3-periphery v1.0.0) — docs v3 arbitrum deployments.
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', protocol: 'uniswap', label: V3_LABEL },
  // SwapRouter02 — docs v3 arbitrum deployments + sdk-core default.
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — arbitrum.json.
  { address: '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (no V2 support) — arbitrum.json.
  { address: '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — arbitrum.json.
  { address: '0x5E325eDA8064b456f4781070C0738d849c824258', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — arbitrum.json; also the docs deployments row.
  { address: '0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — arbitrum.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — arbitrum.json.
  { address: '0x2d01411773c8C24805306E89A41F7855C3c4Fe65', protocol: 'uniswap', label: UR_LABEL },
];

// base — V2 Router02 from the docs v2 table, SwapRouter02 from the docs'
// Base page (no v3-periphery SwapRouter V1 row — Base launched after
// SwapRouter02 superseded it), Universal Router versions from base.json.
// Sources: …/v2/deployments.mdx, …/v3-base-deployments.mdx,
// universal-router/blob/main/deploy-addresses/base.json
const BASE: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Base row).
  { address: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter02 — docs v3 base deployments + sdk-core BASE addresses.
  { address: '0x2626664c2603336E57B271c5C0b26F421741e481', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1.2 (no V2 support) — base.json.
  { address: '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — base.json.
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — base.json; also the docs deployments row.
  { address: '0x6fF5693b99212Da76ad316178A184AB56D299b43', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — base.json.
  { address: '0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — base.json.
  { address: '0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40', protocol: 'uniswap', label: UR_LABEL },
];

// optimism — V2 Router02 from the docs v2 table, V3 SwapRouter +
// SwapRouter02 from the docs' Optimism page, Universal Router versions
// from optimism.json.
// Sources: …/v2/deployments.mdx, …/v3-optimism-deployments.mdx,
// universal-router/blob/main/deploy-addresses/optimism.json
const OPTIMISM: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Optimism row).
  { address: '0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter (v3-periphery v1.0.0) — docs v3 optimism deployments.
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', protocol: 'uniswap', label: V3_LABEL },
  // SwapRouter02 — docs v3 optimism deployments + sdk-core default.
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — optimism.json.
  { address: '0xb555edF5dcF85f42cEeF1f3630a52A108E55A654', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (no V2 support) — optimism.json.
  { address: '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — optimism.json.
  { address: '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2 — optimism.json; also the docs deployments row.
  { address: '0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — optimism.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — optimism.json.
  { address: '0xC09255D86DB563cBc11C2fCf4a0C512e160111B4', protocol: 'uniswap', label: UR_LABEL },
];

// avalanche — V2 Router02 from the docs v2 table, SwapRouter02 from the
// docs' Avalanche page (no SwapRouter V1 row), Universal Router versions
// from avalanche.json plus the docs deployments row's 0x94b7… address
// (published in the docs but absent from the repo's JSON — both are
// official Uniswap publications, so both chip).
// Sources: …/v2/deployments.mdx, …/v3-avalanche-deployments.mdx,
// universal-router/blob/main/deploy-addresses/avalanche.json
const AVALANCHE: readonly KnownRouter[] = [
  // UniswapV2Router02 — docs v2 deployments table (Avalanche row).
  { address: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', protocol: 'uniswap', label: V2_LABEL },
  // SwapRouter02 — docs v3 avalanche deployments + sdk-core AVALANCHE
  // addresses.
  { address: '0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1.2 (no V2 support) — avalanche.json.
  { address: '0x82635AF6146972cD6601161c4472ffe97237D292', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — avalanche.json.
  { address: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter — docs v3 avalanche deployments row.
  { address: '0x94b75331AE8d42C1b61065089B7d48FE14aA73b7', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — avalanche.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — avalanche.json.
  { address: '0x661E93cca42AfacB172121EF892830cA3b70F08d', protocol: 'uniswap', label: UR_LABEL },
];

// celo — SwapRouter02 and the current Universal Router row from the
// docs' Celo page, remaining Universal Router versions from celo.json.
// No V2 Router02 and no SwapRouter V1: the docs publish neither for
// Celo. sdk-core notably has NO celo swapRouter02Address (its router
// fallback is mainnet's address) — the docs page is the only correct
// source here, and its value is what ships.
// Sources: …/v3-celo-deployments.mdx,
// universal-router/blob/main/deploy-addresses/celo.json
const CELO: readonly KnownRouter[] = [
  // SwapRouter02 — docs v3 celo deployments.
  { address: '0x5615CDAb10dc425a742d643d949a7F474C01abc4', protocol: 'uniswap', label: V3_LABEL },
  // UniversalRouter V1 — celo.json.
  { address: '0xC73d61d192FB994157168Fb56730FdEc64C9Cb8F', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V1.2 (V2-supporting) — celo.json; also the docs
  // deployments row.
  { address: '0x643770E279d5D0733F21d6DC03A8efbABf3255B4', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.1 — celo.json.
  { address: '0x8B844f885672f333Bc0042cB669255f93a4C1E6b', protocol: 'uniswap', label: UR_LABEL },
  // UniversalRouter V2.1.2 — celo.json.
  { address: '0xe2023F3FA515cF070e07fD9d51c1d236e07843f4', protocol: 'uniswap', label: UR_LABEL },
];

// fantom — deliberately EMPTY: Uniswap Labs never deployed V2/V3/UR
// routers on Fantom (no entry in any official deployment page, docs
// repo, or sdk-core). Third-party forks exist but are not Uniswap
// deployments — absence stays honest rather than guessing a fork.
const FANTOM: readonly KnownRouter[] = [];

// gnosis — deliberately EMPTY for the same reason as Fantom: no official
// Uniswap deployment exists on Gnosis Chain.
const GNOSIS: readonly KnownRouter[] = [];

/** The curated lists, keyed by chain id (POPULAR_CHAINS members only). */
export const KNOWN_ROUTERS: Readonly<Record<number, readonly KnownRouter[]>> = {
  1: MAINNET,
  137: POLYGON,
  56: BSC,
  42161: ARBITRUM,
  8453: BASE,
  10: OPTIMISM,
  43114: AVALANCHE,
  42220: CELO,
  250: FANTOM,
  100: GNOSIS,
};

// Lowercase-address index per chain, built once: the list lookups run on
// every visible table row, and a linear scan per row inside a map is
// exactly the pattern chains.ts warns about.
const ROUTER_INDEX: ReadonlyMap<number, ReadonlyMap<string, { protocol: string; label: string }>> =
  new Map(
    Object.entries(KNOWN_ROUTERS).map(([chainId, routers]) => [
      Number(chainId),
      new Map(routers.map(router => [router.address.toLowerCase(), { protocol: router.protocol, label: router.label }])),
    ]),
  );

/**
 * Curated protocol identity of a to-address on one chain, or null when
 * the address is not in the curated set. Consumers must treat null as
 * "uncurated" — never as a claim that the address is not a router.
 * Case-insensitive on the address (rows carry raw RPC casing); an
 * address without a chain entry never matches another chain's list.
 */
export function protocolRouterLabel(
  chainId: number,
  address: string | null | undefined,
): { protocol: string; label: string } | null {
  if (address == null || address === '') return null;
  const perChain = ROUTER_INDEX.get(chainId);
  if (perChain === undefined) return null;
  return perChain.get(address.toLowerCase()) ?? null;
}
