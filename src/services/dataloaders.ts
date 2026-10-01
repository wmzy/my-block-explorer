// Data loader triplets for the immutable routes. The route table wires the
// loader (`data: contractSourceLoader` — the identity must be the exported
// loader itself, no arrow re-wrapping); the view reads the same shared cache
// through the plain services hook, so a loader-primed navigation settles the
// view without a second request. Route params arrive as strings, so keyOf
// normalizes them to the fetch's key tuple.
import { createDataLoader } from '@/util/dataLoader';

import { contractSourceCache, fetchContractSource, IMMUTABLE_CACHE_TIME } from './contracts';
import { parseChainIdParam } from '@/utils/chainParam';

type ChainAddressParams = { params: { chainId: string; address: string } };

// keyOf for every chain-scoped entity route: string params → the numeric
// chainId + address the fetch functions key on. The chainId parses
// STRICTLY (parseChainIdParam): Number() read '0x1a' as 26 and '1e5' as
// 100000, so a hand-typed URL keyed AND served the immutable 24h
// contract-source cache of a different chain. Unparseable input becomes
// 0 — never a supported id — and the fetch's own invalid-args guard
// resolves undefined, which the view renders as UnsupportedChainState.
export const chainAddressKey = ({ params }: ChainAddressParams): [number, string] => [
  parseChainIdParam(params.chainId) ?? 0,
  params.address,
];

// Immutable data: a loader hit within 24h serves the cached entry without a
// background revalidation.
export const [contractSourceLoader, useContractSourceData] = createDataLoader({
  fetch: fetchContractSource,
  cache: contractSourceCache,
  keyOf: chainAddressKey,
  staleTime: IMMUTABLE_CACHE_TIME,
});
