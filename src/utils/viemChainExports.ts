// The ONE curated chain-id → 'viem/chains' named-export table. Two
// snippet generators used to carry private copies that silently diverged
// (one shipped fantom 250, the other zksync 324 in its place); consumers
// deep-import this leaf so the membership can never fork again. The set
// is exactly the explorer's POPULAR_CHAINS ids — pinned by
// tests/unit/utils/viemChainExports.test.ts against both config/chains
// and the real 'viem/chains' exports. Every other chain id (testnets,
// custom registrations) goes through the caller's defineChain fallback.
export const VIEM_CHAIN_EXPORTS: ReadonlyMap<number, string> = new Map([
  [1, 'mainnet'],
  [137, 'polygon'],
  [56, 'bsc'],
  [42161, 'arbitrum'],
  [8453, 'base'],
  [10, 'optimism'],
  [43114, 'avalanche'],
  [250, 'fantom'],
  [42220, 'celo'],
  [100, 'gnosis'],
]);
