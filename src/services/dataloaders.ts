// Data loader triplets for the immutable routes. The route table wires the
// loader (`data: contractSourceLoader` — the identity must be the exported
// loader itself, no arrow re-wrapping); the view reads the same shared cache
// through the plain services hook, so a loader-primed navigation settles the
// view without a second request. Route params arrive as strings, so keyOf
// normalizes them to the fetch's key tuple.
import { createDataLoader } from '@/util/dataLoader';

import {
  contractSourceCache,
  fetchContractSource,
  IMMUTABLE_CACHE_TIME,
} from './contracts';

type ChainAddressParams = { params: { chainId: string; address: string } };

// keyOf for every chain-scoped entity route: string params → the numeric
// chainId + address the fetch functions key on. NaN chainIds (malformed
// URLs) hit the fetch's invalid-args guard and resolve undefined.
const chainAddressKey = ({ params }: ChainAddressParams): [number, string] => [
  Number(params.chainId),
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
