// Built-in address label seeds — the curated "the chain you're browsing
// already has names" dataset shipped inside the package. Seeded into
// address_labels on first startup (database/seedBuiltinLabels.ts), so a
// fresh local instance surfaces routers, blue-chip tokens, money markets
// and major CEX hot wallets instead of an ocean of anonymous hex.
//
// Curation contract (a wrong label is worse than none):
// - Every address below was corroborated against at least one primary
//   source at curation time (official deployment docs — Uniswap/Aave/
//   Optimism/Base/Curve/PancakeSwap/Trader Joe/Aerodrome — the official
//   aave-address-book, or the explorer's own contract label page).
//   Where corroboration was not obtainable, the entry was DROPPED, not
//   guessed. Notes carry the provenance so a human can re-verify.
// - Addresses are stored LOWERCASE, matching the project-wide storage
//   convention (C-3) the labels route already normalizes to.
// - Labels fit the address_labels.label varchar(64) cap; notes fit 500.
// - The dataset is deliberately dependency-free: plain data, no imports,
//   so both the backend seeder and future tooling can consume it freely.
//
// User labels always win over seeds: the seeder never overwrites an
// existing row, and PUT on a seeded row converts it to source 'user'.

/** One bundled label: (chainId, lowercase address) → label + provenance note. */
export type BuiltinLabel = {
  chainId: number;
  /** Storage key — always lowercase (C-3 convention). */
  address: `0x${string}`;
  label: string;
  /** Provenance / caveats shown in the UI tooltip. */
  note?: string;
};

// --- Ethereum mainnet (1) ---
const mainnet: readonly BuiltinLabel[] = [
  {
    chainId: 1,
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'WETH',
    note: 'Canonical Wrapped Ether (WETH9) token contract',
  },
  {
    chainId: 1,
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    label: 'USDT',
    note: 'Tether USD (USDT) official Ethereum deployment',
  },
  {
    chainId: 1,
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    label: 'USDC',
    note: 'Circle-issued native USDC on Ethereum',
  },
  {
    chainId: 1,
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    label: 'DAI',
    note: 'MakerDAO Dai Stablecoin (canonical DAI deployment)',
  },
  {
    chainId: 1,
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    label: 'WBTC',
    note: 'Wrapped Bitcoin (WBTC) token contract',
  },
  {
    chainId: 1,
    address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    label: 'stETH',
    note: 'Lido Staked ETH liquid-staking receipt token',
  },
  {
    chainId: 1,
    address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
    label: 'wstETH',
    note: 'Lido Wrapped stETH (rebasing wrapper over stETH)',
  },
  {
    chainId: 1,
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    label: 'LINK',
    note: 'Chainlink (LINK) token contract',
  },
  {
    chainId: 1,
    address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    label: 'Uniswap V2: Router 2',
    note: 'Uniswap V2 Router02 deployment',
  },
  {
    chainId: 1,
    address: '0xe592427a0aece92de3edee1f18e0157c05861564',
    label: 'Uniswap V3: SwapRouter',
    note: 'Uniswap V3 SwapRouter (classic periphery router)',
  },
  {
    chainId: 1,
    address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    label: 'Uniswap V3: SwapRouter02',
    note: 'Uniswap SwapRouter02 deployment',
  },
  {
    chainId: 1,
    address: '0x61ffe014ba17989e743c5f6cb21bf9697530b21e',
    label: 'Uniswap V3: QuoterV2',
    note: 'Uniswap V3 QuoterV2 deployment',
  },
  {
    chainId: 1,
    address: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    label: 'Uniswap: Universal Router',
    note: 'Uniswap Universal Router deployment (ERC20/NFT swaps)',
  },
  {
    chainId: 1,
    address: '0x1111111254eeb25477b68fb85ed929f73a960582',
    label: '1inch: Aggregation Router v5',
    note: '1inch v5 aggregation router deployment',
  },
  {
    chainId: 1,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch: Aggregation Router v6',
    note: '1inch v6 aggregation router deployment',
  },
  {
    chainId: 1,
    address: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
    label: 'Curve: 3pool',
    note: 'Curve StableSwap DAI/USDC/USDT pool (3pool)',
  },
  {
    chainId: 1,
    address: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool mainnet deployment (aave-address-book)',
  },
  {
    chainId: 1,
    address: '0x28c6c06298d514db089934071355e5743bf21d60',
    label: 'Binance 14',
    note: 'Etherscan-labelled Binance exchange hot wallet',
  },
  {
    chainId: 1,
    address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
    label: 'Binance 16',
    note: 'Etherscan-labelled Binance exchange hot wallet',
  },
  {
    chainId: 1,
    address: '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
    label: 'Coinbase 1',
    note: 'Etherscan-labelled Coinbase exchange hot wallet',
  },
  {
    chainId: 1,
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    label: 'Vitalik Buterin',
    note: 'vitalik.eth — well-known public EOA',
  },
  {
    chainId: 1,
    address: '0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef',
    label: 'Arbitrum: L1 Gateway Router',
    note: 'Arbitrum One canonical L1 bridge gateway router (Ethereum side)',
  },
  {
    chainId: 1,
    address: '0xeb9bf100225c214efc3e7c651ebbadcf85177607',
    label: 'Optimism: L1StandardBridge',
    note: 'OP Mainnet canonical L1 standard bridge (Ethereum side)',
  },
];

// --- Polygon PoS (137) ---
const polygon: readonly BuiltinLabel[] = [
  {
    chainId: 137,
    address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    label: 'WMATIC',
    note: 'Canonical Wrapped POL/MATIC token contract',
  },
  {
    chainId: 137,
    address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    label: 'WETH',
    note: 'Bridged Wrapped Ether on Polygon',
  },
  {
    chainId: 137,
    address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    label: 'USDC.e',
    note: 'Bridged USDC (PoS) on Polygon — legacy, superseded by native USDC',
  },
  {
    chainId: 137,
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    label: 'USDC',
    note: 'Circle-issued native USDC on Polygon',
  },
  {
    chainId: 137,
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    label: 'USDT',
    note: 'Tether USD (Binance-Peg) on Polygon',
  },
  {
    chainId: 137,
    address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    label: 'Uniswap V3: SwapRouter02',
    note: 'Uniswap SwapRouter02 deployment (same address as mainnet)',
  },
  {
    chainId: 137,
    address: '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff',
    label: 'QuickSwap: Router',
    note: 'QuickSwap Uniswap-V2-style router deployment',
  },
  {
    chainId: 137,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch: Aggregation Router v6',
    note: '1inch v6 aggregation router deployment',
  },
  {
    chainId: 137,
    address: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool Polygon deployment (aave-address-book)',
  },
];

// --- Arbitrum One (42161) ---
const arbitrum: readonly BuiltinLabel[] = [
  {
    chainId: 42161,
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    label: 'WETH',
    note: 'Canonical Wrapped Ether on Arbitrum One',
  },
  {
    chainId: 42161,
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    label: 'USDC',
    note: 'Circle-issued native USDC on Arbitrum One',
  },
  {
    chainId: 42161,
    address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    label: 'USDC.e',
    note: 'Bridged USDC on Arbitrum — legacy, superseded by native USDC',
  },
  {
    chainId: 42161,
    address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    label: 'USDT',
    note: 'Tether USD on Arbitrum One',
  },
  {
    chainId: 42161,
    address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
    label: 'WBTC',
    note: 'Bridged Wrapped Bitcoin on Arbitrum One',
  },
  {
    chainId: 42161,
    address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    label: 'Uniswap V3: SwapRouter02',
    note: 'Uniswap SwapRouter02 deployment (same address as mainnet)',
  },
  {
    chainId: 42161,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch: Aggregation Router v6',
    note: '1inch v6 aggregation router deployment',
  },
  {
    chainId: 42161,
    address: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool Arbitrum deployment (aave-address-book)',
  },
];

// --- OP Mainnet / Optimism (10) ---
const optimism: readonly BuiltinLabel[] = [
  {
    chainId: 10,
    address: '0x4200000000000000000000000000000000000006',
    label: 'WETH',
    note: 'OP-Stack WETH9 predeploy (fixed 0x4200…0006 namespace)',
  },
  {
    chainId: 10,
    address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
    label: 'USDC.e',
    note: 'Bridged USDC on OP Mainnet — legacy, superseded by native USDC',
  },
  {
    chainId: 10,
    address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    label: 'USDC',
    note: 'Circle-issued native USDC on OP Mainnet',
  },
  {
    chainId: 10,
    address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    label: 'Uniswap V3: SwapRouter02',
    note: 'Uniswap SwapRouter02 deployment (same address as mainnet)',
  },
  {
    chainId: 10,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch: Aggregation Router v6',
    note: '1inch v6 aggregation router deployment',
  },
  {
    chainId: 10,
    address: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool OP Mainnet deployment (aave-address-book)',
  },
  {
    chainId: 10,
    address: '0x4200000000000000000000000000000000000010',
    label: 'OP: Standard Bridge',
    note: 'OP-Stack L2StandardBridge predeploy (canonical L2 bridge)',
  },
];

// --- Base (8453) ---
const base: readonly BuiltinLabel[] = [
  {
    chainId: 8453,
    address: '0x4200000000000000000000000000000000000006',
    label: 'WETH',
    note: 'OP-Stack WETH9 predeploy (fixed 0x4200…0006 namespace)',
  },
  {
    chainId: 8453,
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    label: 'USDC',
    note: 'Circle-issued native USDC on Base',
  },
  {
    chainId: 8453,
    address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
    label: 'DAI',
    note: 'Bridged Dai Stablecoin on Base',
  },
  {
    chainId: 8453,
    address: '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
    label: 'Aerodrome: Router',
    note: 'Aerodrome AMM router deployment (official repo address book)',
  },
  {
    chainId: 8453,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch: Aggregation Router v6',
    note: '1inch v6 aggregation router deployment',
  },
  {
    chainId: 8453,
    address: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool Base deployment (aave-address-book)',
  },
  {
    chainId: 8453,
    address: '0x4200000000000000000000000000000000000010',
    label: 'Base: Standard Bridge',
    note: 'OP-Stack L2StandardBridge predeploy (canonical L2 bridge)',
  },
];

// --- BNB Smart Chain (56) ---
const bsc: readonly BuiltinLabel[] = [
  {
    chainId: 56,
    address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    label: 'WBNB',
    note: 'Canonical Wrapped BNB token contract',
  },
  {
    chainId: 56,
    address: '0x55d398326f99059ff775485246999027b3197955',
    label: 'USDT',
    note: 'Binance-Peg Tether USD on BNB Chain',
  },
  {
    chainId: 56,
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    label: 'USDC',
    note: 'Binance-Peg USD Coin on BNB Chain',
  },
  {
    chainId: 56,
    address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
    label: 'BUSD',
    note: 'Binance-Peg Binance USD on BNB Chain',
  },
  {
    chainId: 56,
    address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
    label: 'BTCB',
    note: 'Binance-Peg Bitcoin on BNB Chain',
  },
  {
    chainId: 56,
    address: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
    label: 'PancakeSwap: Router v2',
    note: 'PancakeSwap V2 router deployment (official docs)',
  },
  {
    chainId: 56,
    address: '0x1b81d678ffb9c0263b24a97847620c99d213eb14',
    label: 'PancakeSwap: V3 Swap Router',
    note: 'PancakeSwap V3 swap router deployment (official docs)',
  },
];

// --- Avalanche C-Chain (43114) ---
const avalanche: readonly BuiltinLabel[] = [
  {
    chainId: 43114,
    address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    label: 'WAVAX',
    note: 'Canonical Wrapped AVAX token contract',
  },
  {
    chainId: 43114,
    address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    label: 'USDC',
    note: 'Circle-issued native USDC on Avalanche',
  },
  {
    chainId: 43114,
    address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    label: 'USDT',
    note: 'Tether USD on Avalanche C-Chain',
  },
  {
    chainId: 43114,
    address: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
    label: 'WETH.e',
    note: 'Bridged Wrapped Ether on Avalanche',
  },
  {
    chainId: 43114,
    address: '0x60ae616a2155ee3d9a68541ba4544862310933d4',
    label: 'Trader Joe: Router',
    note: 'Trader Joe (LFJ) V1 router deployment (official docs)',
  },
  {
    chainId: 43114,
    address: '0xb4315e873dbcf96ffd0acd8ea43f689d8c20fb30',
    label: 'Trader Joe: LBRouter',
    note: 'Trader Joe (LFJ) Liquidity Book router deployment (official docs)',
  },
  {
    chainId: 43114,
    address: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
    label: 'Aave V3: Pool',
    note: 'Aave V3 Pool Avalanche deployment (aave-address-book)',
  },
];

/** The full bundled dataset, all chains concatenated. */
export const BUILTIN_LABELS: readonly BuiltinLabel[] = [
  ...mainnet,
  ...polygon,
  ...arbitrum,
  ...optimism,
  ...base,
  ...bsc,
  ...avalanche,
];
