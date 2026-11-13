// The ONE curated chain-id → 'viem/chains' named-export table, pinned at
// its source: the key set is exactly the explorer's POPULAR_CHAINS ids
// (no silent additions or dropouts), and every mapped name is a real
// 'viem/chains' export (viem ≥2.16 renamed bnb → bsc; a stale name would
// break the import line of every generated snippet).
import { describe, expect, it } from 'vitest';
import * as viemChains from 'viem/chains';

import { POPULAR_CHAINS } from '@/config/chains';
import { VIEM_CHAIN_EXPORTS } from '@/utils/viemChainExports';

describe('VIEM_CHAIN_EXPORTS', () => {
  it('maps exactly the POPULAR_CHAINS ids — no more, no less', () => {
    expect([...VIEM_CHAIN_EXPORTS.keys()].sort((a, b) => a - b)).toEqual(
      [...POPULAR_CHAINS.map(chain => chain.id)].sort((a, b) => a - b),
    );
  });

  it('maps every id to a real viem/chains export', () => {
    for (const name of VIEM_CHAIN_EXPORTS.values()) {
      expect(viemChains).toHaveProperty(name);
    }
  });
});
