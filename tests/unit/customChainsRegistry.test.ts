// Registry override semantics: a registered custom chain resolves
// through every chain-config lookup — getChainInfo/getChainName/
// getChainSymbol/getDefaultRpcUrl/isChainSupported — and WINS over viem
// for its id, which is what makes the registered RPC actually serve
// (viem 2.56 ships anvil/hardhat/foundry at id 31337 with loopback
// placeholder defaults; a registration over them is the advertised
// path). Real viem networks stay protected at the route layer
// (isBuiltInChainProtected), and removal restores viem's answer exactly.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCustomChain,
  removeCustomChain,
  listCustomChains,
  listCustomChainIds,
  getCustomChain,
  toViemChain,
  resetCustomChainsForTests,
  type CustomChain,
} from '@/config/customChains';
import {
  getChainInfo,
  getBuiltInChainInfo,
  getChainName,
  getChainSymbol,
  getDefaultRpcUrl,
  isChainSupported,
  isBuiltInChainProtected,
} from '@/config/chains';

// viem's local-dev placeholder id (anvil/hardhat/foundry all share it).
const ANVIL_ID = 31337;
// An id viem does not ship at all.
const UNKNOWN_ID = 42424242;

const anvil = (): CustomChain => ({
  chainId: ANVIL_ID,
  name: 'Anvil Local',
  symbol: 'ETH',
  decimals: 18,
  rpcUrl: 'http://127.0.0.1:8546',
});

beforeEach(() => {
  resetCustomChainsForTests();
});

describe('custom-chain registry', () => {
  it('is empty initially: nothing registered, viem answers on its own', () => {
    expect(getCustomChain(ANVIL_ID)).toBeUndefined();
    expect(listCustomChains()).toEqual([]);
    expect(listCustomChainIds()).toEqual([]);
    // viem ships the anvil placeholder; a truly unknown id stays unknown.
    expect(getBuiltInChainInfo(ANVIL_ID)?.name).toBe('Anvil');
    expect(getBuiltInChainInfo(UNKNOWN_ID)).toBeNull();
    expect(getChainInfo(UNKNOWN_ID)).toBeNull();
    expect(isChainSupported(UNKNOWN_ID)).toBe(false);
  });

  it('registers and lists chains sorted by id', () => {
    registerCustomChain({ chainId: 1337, name: 'Ganache', symbol: 'GO', decimals: 18, rpcUrl: 'http://x' });
    registerCustomChain(anvil());

    expect(listCustomChainIds()).toEqual([1337, ANVIL_ID]);
    expect(listCustomChains().map(c => c.chainId)).toEqual([1337, ANVIL_ID]);
  });

  it('re-registering the same id replaces the entry', () => {
    registerCustomChain(anvil());
    registerCustomChain({ ...anvil(), name: 'Renamed' });

    expect(listCustomChains()).toHaveLength(1);
    expect(getCustomChain(ANVIL_ID)?.name).toBe('Renamed');
  });

  it('removeCustomChain reports whether a registration existed', () => {
    registerCustomChain(anvil());
    expect(removeCustomChain(ANVIL_ID)).toBe(true);
    expect(removeCustomChain(ANVIL_ID)).toBe(false);
    expect(getCustomChain(ANVIL_ID)).toBeUndefined();
  });

  it('toViemChain builds the minimal viem-compatible Chain shape', () => {
    const chain = toViemChain({ ...anvil(), symbol: 'GO', decimals: 9 });

    expect(chain.id).toBe(ANVIL_ID);
    expect(chain.name).toBe('Anvil Local');
    expect(chain.nativeCurrency).toEqual({ name: 'Anvil Local', symbol: 'GO', decimals: 9 });
    expect(chain.rpcUrls.default.http).toEqual(['http://127.0.0.1:8546']);
  });
});

describe('viem placeholder protection classification', () => {
  it('marks real viem networks as protected', () => {
    expect(isBuiltInChainProtected(1)).toBe(true);
    expect(isBuiltInChainProtected(137)).toBe(true);
  });

  it('leaves viem local-dev placeholders registrable (loopback defaults)', () => {
    expect(isBuiltInChainProtected(ANVIL_ID)).toBe(false);
  });

  it('leaves ids viem does not ship registrable', () => {
    expect(isBuiltInChainProtected(UNKNOWN_ID)).toBe(false);
  });
});

describe('chains.ts override layer', () => {
  it('a registration resolves through every lookup and overrides the placeholder', () => {
    registerCustomChain({ ...anvil(), symbol: 'GO', decimals: 9 });

    const chain = getChainInfo(ANVIL_ID);
    expect(chain).not.toBeNull();
    expect(chain?.id).toBe(ANVIL_ID);
    expect(chain?.name).toBe('Anvil Local');
    expect(chain?.nativeCurrency.symbol).toBe('GO');
    expect(chain?.nativeCurrency.decimals).toBe(9);
    expect(chain?.rpcUrls.default.http).toEqual(['http://127.0.0.1:8546']);
    expect(getChainName(ANVIL_ID)).toBe('Anvil Local');
    expect(getChainSymbol(ANVIL_ID)).toBe('GO');
    expect(getDefaultRpcUrl(ANVIL_ID)).toBe('http://127.0.0.1:8546');
    expect(isChainSupported(ANVIL_ID)).toBe(true);
  });

  it('an id unknown to viem resolves only once registered', () => {
    expect(getChainInfo(UNKNOWN_ID)).toBeNull();
    registerCustomChain({ chainId: UNKNOWN_ID, name: 'Private', symbol: 'PVT', decimals: 18, rpcUrl: 'http://10.0.0.2:8545' });

    expect(getChainName(UNKNOWN_ID)).toBe('Private');
    expect(getDefaultRpcUrl(UNKNOWN_ID)).toBe('http://10.0.0.2:8545');
    expect(isChainSupported(UNKNOWN_ID)).toBe(true);
  });

  it('removal restores viem’s own answer for the placeholder id', () => {
    registerCustomChain(anvil());
    removeCustomChain(ANVIL_ID);

    expect(getChainInfo(ANVIL_ID)?.name).toBe('Anvil');
    expect(getDefaultRpcUrl(ANVIL_ID)).toBe('http://127.0.0.1:8545');
    expect(getChainName(UNKNOWN_ID)).toBe(`Chain ${UNKNOWN_ID}`);
    expect(getChainSymbol(UNKNOWN_ID)).toBe('ETH');
    expect(getDefaultRpcUrl(UNKNOWN_ID)).toBe('');
    expect(isChainSupported(UNKNOWN_ID)).toBe(false);
  });
});
