// Curated per-chain "known tokens" for the address page's live balance
// check (services/knownTokenBalances). ONE address list per POPULAR_CHAINS
// member, every entry corroborated on 2026-09-23 against at least two of:
// the DefiLlama prices API (coins.llama.fi echoes symbol+decimals for the
// exact runtime price id), an on-chain symbol()/decimals() read through a
// public RPC, and the canonical publisher (explorer token page, issuer
// docs, or project GitHub). A wrong address here is a correctness bug, so
// chains we could not corroborate widely ship a shorter honest list —
// never a guess, never padding.
//
// Honesty contract: the `symbol` field is a DISPLAY HINT ONLY (shown while
// the runtime metadata read is in flight or unreadable). decimals and
// symbol truth always resolve from the chain at runtime
// (views/Address/TokenTransfers' useTokenMetas session cache), so a stale
// hint can never fabricate amounts. Addresses are stored EIP-55
// checksummed; consumers lowercase them for cache/map keys.

/** One curated token: contract address plus the display-symbol hint. */
export type KnownToken = {
  address: `0x${string}`;
  symbol: string;
};

// mainnet — all 16 entries: DefiLlama prices symbol match + on-chain
// symbol()/decimals() match (MKR's symbol() returns bytes32 and fails the
// string decode; its DefiLlama listing at the same address carries the
// price, and the address is Maker's long-documented canonical).
const MAINNET: readonly KnownToken[] = [
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH' },
  { address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', symbol: 'wstETH' },
  { address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH' },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT' },
  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI' },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC' },
  { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK' },
  { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI' },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE' },
  { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', symbol: 'MKR' },
  { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', symbol: 'LDO' },
  { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', symbol: 'CRV' },
  { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB' },
  { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE' },
  { address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', symbol: 'FRAX' },
];

// polygon — all 12: DefiLlama symbol match + on-chain match. Two renames
// the chain itself answers: the wrapped-native contract reports WPOL
// (DefiLlama still lists WMATIC) and the 0xc213… USDT now reports USDT0
// (Tether's 2025 omnichain migration of the Polygon PoS deployment).
const POLYGON: readonly KnownToken[] = [
  { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH' },
  { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WPOL' },
  { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC' },
  { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e' },
  { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT' },
  { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI' },
  { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC' },
  { address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', symbol: 'LINK' },
  { address: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', symbol: 'AAVE' },
  { address: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', symbol: 'UNI' },
  { address: '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4', symbol: 'stMATIC' },
  { address: '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6', symbol: 'MaticX' },
];

// bsc — all 10: DefiLlama symbol match + on-chain match; DAI, LINK and
// FDUSD additionally fixed to their canonical pages (BscScan token page,
// Chainlink's official link-token-contracts doc, First Digital's BscScan
// listing) after three plausible-looking from-memory addresses proved to
// have no contract code.
const BSC: readonly KnownToken[] = [
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB' },
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
  { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB' },
  { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH' },
  { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI' },
  { address: '0x404460C6A5EdE2D891e8297795264fDe62ADBB75', symbol: 'LINK' },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
  { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD' },
  { address: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', symbol: 'FDUSD' },
];

// arbitrum — all 11: DefiLlama + on-chain. USDT is the post-Jan-2025
// USDT0 deployment Tether migrated Arbitrum to (Arbiscan token page +
// usdt0.to); PENDLE is the Arbiscan-listed canonical (pendle-finance
// GitHub sources the same token).
const ARBITRUM: readonly KnownToken[] = [
  { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH' },
  { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' },
  { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC.e' },
  { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT' },
  { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI' },
  { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC' },
  { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB' },
  { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', symbol: 'LINK' },
  { address: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', symbol: 'UNI' },
  { address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', symbol: 'GMX' },
  { address: '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', symbol: 'PENDLE' },
];

// base — all 7: DefiLlama + on-chain; USDbC and AERO fixed to their
// canonical pages (BaseScan token page + Circle's native-USDC notice;
// BaseScan + aerodrome-finance GitHub) after the from-memory addresses
// proved codeless.
const BASE: readonly KnownToken[] = [
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC' },
  { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH' },
  { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC' },
  { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', symbol: 'AERO' },
  { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', symbol: 'DEGEN' },
];

// optimism — all 10: DefiLlama + on-chain; USDC.e fixed against Optimism's
// official bridged-token doc + optimistic.etherscan token page, VELO is
// the live VelodromeV2 token those same pages list.
const OPTIMISM: readonly KnownToken[] = [
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
  { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC' },
  { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC.e' },
  { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT' },
  { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI' },
  { address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', symbol: 'WBTC' },
  { address: '0x4200000000000000000000000000000000000042', symbol: 'OP' },
  { address: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', symbol: 'LINK' },
  { address: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', symbol: 'VELO' },
  { address: '0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4', symbol: 'SNX' },
];

// avalanche — all 8: DefiLlama + on-chain (LINK reports LINK.e on-chain —
// the canonical Chainlink deployment for Avalanche; sAVAX fixed against
// BENQI's official contracts doc after the from-memory address proved
// codeless).
const AVALANCHE: readonly KnownToken[] = [
  { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX' },
  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC' },
  { address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', symbol: 'USDC.e' },
  { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT.e' },
  { address: '0x152b9d0FdC40C096757F570A51E494bd4b943E50', symbol: 'BTC.b' },
  { address: '0x5947BB275c521040051D82396192181b413227A3', symbol: 'LINK' },
  { address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', symbol: 'JOE' },
  { address: '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE', symbol: 'sAVAX' },
];

// fantom — deliberately the honest short list: post-Multichain collapse
// only these two could be double-corroborated (both DefiLlama + on-chain;
// USDC additionally against the FTMScan token tracker). Bridged DAI/USDT
// candidates could not be verified, so they are absent rather than
// guessed.
const FANTOM: readonly KnownToken[] = [
  { address: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', symbol: 'WFTM' },
  { address: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75', symbol: 'USDC' },
];

// celo — the honest short list: only EURm and native USDC are
// double-corroborated LIVE (on-chain symbol()/decimals() on two
// independent RPCs + celo-org's own published token list; DefiLlama also
// prices EURm at this address). The L1-era cUSD contract and the
// fee-currency-directory addresses in the Celo docs carry no code on the
// post-L2-migration chain and are excluded rather than guessed.
const CELO: readonly KnownToken[] = [
  { address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73', symbol: 'EURm' },
  { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', symbol: 'USDC' },
];

// gnosis — WXDAI fixed against docs.gnosischain.com's token page (the
// from-memory address proved codeless), WETH is the OmniBridge-bridged
// WETH Blockscout lists with 16M+ transfers, USDC/USDC.e verified
// on-chain (both report their own symbols), GNO/LINK/sDAI double-verified
// (DefiLlama + on-chain). OmniBridge DAI is a ~$60k residual next to
// native WXDAI and stays off the list on purpose.
const GNOSIS: readonly KnownToken[] = [
  { address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', symbol: 'WXDAI' },
  { address: '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1', symbol: 'WETH' },
  { address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb', symbol: 'GNO' },
  { address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', symbol: 'USDC' },
  { address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', symbol: 'USDC.e' },
  { address: '0xE2e73A1c69ecF83F464EFCE6A5be353a37cA09b2', symbol: 'LINK' },
  { address: '0xaf204776c7245bF4147c2612BF6e5972Ee483701', symbol: 'sDAI' },
];

/** The curated lists, keyed by chain id (POPULAR_CHAINS members only). */
export const KNOWN_TOKENS: Readonly<Record<number, readonly KnownToken[]>> = {
  1: MAINNET,
  10: OPTIMISM,
  56: BSC,
  100: GNOSIS,
  137: POLYGON,
  250: FANTOM,
  8453: BASE,
  42161: ARBITRUM,
  42220: CELO,
  43114: AVALANCHE,
};

/**
 * Curated known-token list of one chain, or [] when the chain has no
 * curated list (consumers treat that as "nothing to check", never as an
 * error or an empty-wallet claim).
 */
export function knownTokensForChain(chainId: number): readonly KnownToken[] {
  return KNOWN_TOKENS[chainId] ?? [];
}
