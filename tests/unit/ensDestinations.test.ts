// ENS destination decision: a resolved name is a fact of Ethereum
// mainnet (where the registry lives), so that is always the primary
// destination; the chain the user was browsing is offered as the
// secondary only when it differs — browsing mainnet leaves nothing to
// choose between.
import { describe, it, expect } from 'vitest';
import { ensDestinations, ENS_RESOLUTION_CHAIN_ID } from '@/services/ensForward';

describe('ensDestinations', () => {
  it('makes Ethereum the primary regardless of the viewing chain', () => {
    expect(ensDestinations(137).primaryChainId).toBe(1);
    expect(ensDestinations(5000).primaryChainId).toBe(1);
    expect(ensDestinations(undefined).primaryChainId).toBe(1);
    expect(ENS_RESOLUTION_CHAIN_ID).toBe(1);
  });

  it('offers the viewing chain as the alternate when it is not mainnet', () => {
    expect(ensDestinations(137)).toEqual({ primaryChainId: 1, alternateChainId: 137 });
    expect(ensDestinations(5000)).toEqual({ primaryChainId: 1, alternateChainId: 5000 });
  });

  it('offers no alternate on mainnet itself', () => {
    expect(ensDestinations(1)).toEqual({ primaryChainId: 1, alternateChainId: null });
  });

  it('offers no alternate without a viewing chain', () => {
    expect(ensDestinations(undefined)).toEqual({ primaryChainId: 1, alternateChainId: null });
  });
});
