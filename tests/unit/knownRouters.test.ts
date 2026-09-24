// Lookup-contract tests for the curated known-routers set: case-
// insensitive matching, per-chain isolation (an address only chips on
// chains whose official Uniswap deployment list contains it — including
// the deliberately-shared deterministic deployments), honest null for
// uncurated chains (Fantom/Gnosis ship no entries) and unknown
// addresses, plus data hygiene (every stored address EIP-55 checksummed,
// no duplicate address within a chain) so a pasted bad entry fails fast.
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';

import { KNOWN_ROUTERS, protocolRouterLabel } from '@/config/knownRouters';

// mainnet-only: the original UniswapV2Router02 deployment.
const MAINNET_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
// Deterministic multichain V2 Router02: officially deployed at the SAME
// address on Arbitrum, Avalanche, BNB and Base — but not on mainnet.
const MULTICHAIN_V2_ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
// v3-periphery SwapRouter (V1): same address on the four chains the docs
// list it for; the BNB docs page has no SwapRouter row at all.
const V3_SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const MAINNET_SWAP_ROUTER02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

describe('protocolRouterLabel matching', () => {
  it('matches an EIP-55 checksummed input with its label and protocol', () => {
    expect(protocolRouterLabel(1, MAINNET_SWAP_ROUTER02)).toEqual({
      protocol: 'uniswap',
      label: 'Uniswap V3',
    });
  });

  it('matches a lowercase input (rows carry raw RPC casing)', () => {
    expect(protocolRouterLabel(1, MAINNET_V2_ROUTER.toLowerCase())?.label).toBe('Uniswap V2');
  });

  it('matches any other casing of the same address', () => {
    expect(protocolRouterLabel(1, MAINNET_V2_ROUTER.toUpperCase())?.label).toBe('Uniswap V2');
    expect(protocolRouterLabel(137, V3_SWAP_ROUTER.toLowerCase())?.label).toBe('Uniswap V3');
  });

  it('labels every Universal Router version with the plain protocol name', () => {
    // The docs' current mainnet UniversalRouter row (the repo's V2 entry).
    expect(protocolRouterLabel(1, '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af')?.label).toBe(
      'Uniswap',
    );
    // The long-lived V1.2 deployment shared by mainnet and Base.
    expect(protocolRouterLabel(8453, '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD')?.label).toBe(
      'Uniswap',
    );
  });

  it('returns null for an unknown address on a curated chain', () => {
    expect(protocolRouterLabel(1, '0x0000000000000000000000000000000000000001')).toBeNull();
  });

  it('returns null for absent/empty addresses (creation rows)', () => {
    expect(protocolRouterLabel(1, null)).toBeNull();
    expect(protocolRouterLabel(1, undefined)).toBeNull();
    expect(protocolRouterLabel(1, '')).toBeNull();
  });

  it('returns null for input that is not an address at all', () => {
    expect(protocolRouterLabel(1, 'not-an-address')).toBeNull();
  });
});

describe('protocolRouterLabel cross-chain isolation', () => {
  it('does not match a mainnet-only router on other chains', () => {
    expect(protocolRouterLabel(1, MAINNET_V2_ROUTER)).not.toBeNull();
    expect(protocolRouterLabel(137, MAINNET_V2_ROUTER)).toBeNull();
    expect(protocolRouterLabel(56, MAINNET_V2_ROUTER)).toBeNull();
  });

  it('matches a deterministic same-address deployment on each chain it was deployed to', () => {
    for (const chainId of [56, 42161, 8453, 43114]) {
      expect(protocolRouterLabel(chainId, MULTICHAIN_V2_ROUTER)?.label).toBe('Uniswap V2');
    }
    // …and only those chains: the address is NOT a mainnet deployment.
    expect(protocolRouterLabel(1, MULTICHAIN_V2_ROUTER)).toBeNull();
    expect(protocolRouterLabel(137, MULTICHAIN_V2_ROUTER)).toBeNull();
  });

  it('matches the v3 SwapRouter only on the four chains the docs list it for', () => {
    for (const chainId of [1, 137, 42161, 10]) {
      expect(protocolRouterLabel(chainId, V3_SWAP_ROUTER)?.label).toBe('Uniswap V3');
    }
    // BNB's deployment page lists no SwapRouter (V1) row — no entry, no
    // guess, even though the address is a router on four other chains.
    expect(protocolRouterLabel(56, V3_SWAP_ROUTER)).toBeNull();
    expect(protocolRouterLabel(8453, V3_SWAP_ROUTER)).toBeNull();
  });

  it('returns null on chains with no curated list (Fantom/Gnosis never had official deployments)', () => {
    expect(protocolRouterLabel(250, MAINNET_SWAP_ROUTER02)).toBeNull();
    expect(protocolRouterLabel(100, MULTICHAIN_V2_ROUTER)).toBeNull();
    expect(KNOWN_ROUTERS[250]).toEqual([]);
    expect(KNOWN_ROUTERS[100]).toEqual([]);
  });

  it('returns null for an unknown chain id', () => {
    expect(protocolRouterLabel(999_999, MAINNET_V2_ROUTER)).toBeNull();
  });
});

describe('known routers data hygiene', () => {
  it('stores every address EIP-55 checksummed', () => {
    for (const [chainId, routers] of Object.entries(KNOWN_ROUTERS)) {
      for (const router of routers) {
        expect(getAddress(router.address), `chain ${chainId}`).toBe(router.address);
      }
    }
  });

  it('has no duplicate address within a chain', () => {
    for (const [chainId, routers] of Object.entries(KNOWN_ROUTERS)) {
      const addresses = routers.map(router => router.address.toLowerCase());
      expect(new Set(addresses).size, `chain ${chainId}`).toBe(addresses.length);
    }
  });

  it('chips only known protocol families with non-empty labels', () => {
    for (const routers of Object.values(KNOWN_ROUTERS)) {
      for (const router of routers) {
        expect(router.protocol.length).toBeGreaterThan(0);
        expect(router.label.length).toBeGreaterThan(0);
      }
    }
  });
});
