// Lazy full-registry semantics of @/config/chains: the curated static
// subset serves with NO barrel load, ensureBuiltInChainsLoaded() swaps in
// the full viem barrel exactly once (cached promise, single barrel
// instantiation, version bump + listener notification), and every lookup
// family serves the full set afterwards. Byte-identical ordering parity
// against the reference implementations stays in chains-index.test.ts.
import { describe, it, expect, vi } from 'vitest';
import {
  SUPPORTED_CHAINS,
  getBuiltInChainInfo,
  getBuiltInChainsVersion,
  getChainInfo,
  getChainSymbol,
  getChainType,
  getSortedChains,
  isBuiltInChainProtected,
  subscribeBuiltInChains,
  ensureBuiltInChainsLoaded,
} from '@/config/chains';

// The viem barrel is mocked with the REAL module purely so the factory
// call counts instantiations: the static named imports (the subset) and
// the dynamic import inside ensureBuiltInChainsLoaded must share ONE
// instantiation — that is the idempotence proof. No load has happened
// yet at module scope, so the subset serves during the first test.
const barrel = vi.hoisted(() => ({ instantiations: 0 }));
vi.mock('viem/chains', async importOriginal => {
  barrel.instantiations += 1;
  return importOriginal<typeof import('viem/chains')>();
});

// Zora: a REAL viem chain deliberately outside the curated startup
// subset — the rare-chain deep-link scenario.
const ZORA_ID = 7777777;

describe('lazy built-in chains registry', () => {
  it('serves the curated subset with NO registry load', () => {
    expect(barrel.instantiations).toBe(1); // the static import only
    expect(getBuiltInChainsVersion()).toBe(0);

    // Popular and dev chains resolve statically.
    expect(getChainInfo(1)?.name).toBe('Ethereum');
    expect(getChainInfo(137)?.nativeCurrency.symbol).toBe('POL');
    expect(getChainInfo(31337)?.name).toBe('Anvil');
    expect(getChainType(11155420)).toBe('testnet'); // OP Sepolia
    expect(getChainSymbol(5000)).toBe('MNT'); // Mantle

    // The 409-conflict gate already protects real chains in the subset.
    expect(isBuiltInChainProtected(1)).toBe(true);
    expect(isBuiltInChainProtected(31337)).toBe(false); // placeholder

    // A real viem chain OUTSIDE the subset is unknown until the barrel
    // loads — the one behavior UnsupportedChainState recovers from.
    expect(getBuiltInChainInfo(ZORA_ID)).toBeNull();
    expect(getChainType(ZORA_ID)).toBe('unknown');

    // Every curated id is distinct (no alias duplicates in the subset).
    expect(new Set(SUPPORTED_CHAINS.map(chain => chain.id)).size).toBe(SUPPORTED_CHAINS.length);
  });

  it('loads the barrel once, rebuilds, and notifies listeners', async () => {
    const notified: number[] = [];
    const unsubscribe = subscribeBuiltInChains(() =>
      notified.push(getBuiltInChainsVersion()),
    );
    const versionBefore = getBuiltInChainsVersion();

    const first = ensureBuiltInChainsLoaded();
    // Idempotence: concurrent and subsequent calls share ONE promise —
    // one dynamic import, one rebuild.
    expect(ensureBuiltInChainsLoaded()).toBe(first);
    await first;
    expect(ensureBuiltInChainsLoaded()).toBe(first);

    expect(getBuiltInChainsVersion()).toBe(versionBefore + 1);
    expect(notified).toEqual([versionBefore + 1]);
    expect(barrel.instantiations).toBe(1);
    unsubscribe();
  });

  it('serves the full viem registry after the load', () => {
    expect(SUPPORTED_CHAINS.length).toBeGreaterThan(500);
    expect(getBuiltInChainInfo(ZORA_ID)?.id).toBe(ZORA_ID);
    expect(getChainInfo(ZORA_ID)?.name).toMatch(/Zora/);
    expect(getChainType(ZORA_ID)).toBe('mainnet');

    // Sorted list still dedupes alias exports sharing one id.
    const sorted = getSortedChains();
    const ids = sorted.map(chain => chain.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(new Set(SUPPORTED_CHAINS.map(chain => chain.id)).size);

    // The 409 gate sees real chains that only the barrel ships.
    expect(isBuiltInChainProtected(ZORA_ID)).toBe(true);

    // viem's placeholder keeps its first-export answer (anvil) after the
    // rebuild — the custom-chain default-RPC contract.
    expect(getBuiltInChainInfo(31337)?.name).toBe('Anvil');
  });
});
