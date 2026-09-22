// Minimal EIP-1193 injected-provider facade for the contract Interact
// wallet-send path. Zero new dependencies: the type below is the tiny
// slice of the standard an eth_sendTransaction needs, spelled by hand so
// no wallet SDK enters the bundle.
//
// No key material is ever handled here — every method only forwards a
// request to the wallet's own injected provider and shape-checks the
// answer. Chain-switch payloads are built from the explorer's chain
// registry (viem-known chains carry every field EIP-3085 requires).
//
// EIP-6963 multi-provider discovery is deliberately skipped: it adds an
// event protocol for choosing BETWEEN wallets, which the single
// window.ethereum read covers for this tool's local-first scope.

import { useEffect, useState } from 'react';
import type { Chain } from 'viem';

// The request/event surface of an injected provider (EIP-1193). `on`/
// `removeListener` carry the two liveness events this module consumes:
// chainChanged (hex string) and accountsChanged (string[]).
export type EIP1193Provider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
};

// eth_sendTransaction params exactly as this feature builds them. No gas
// field on purpose — the wallet estimates; a hardcoded limit would be a
// guess this explorer cannot make honestly.
export type WalletTransactionRequest = {
  from: string;
  to: string;
  data: string;
  /** Hex-encoded wei quantity (payable calls only). */
  value?: string;
};

// Outcome of walking the wallet onto the explorer's chain. The four
// machine outcomes are exactly the ones the UI writes copy for; anything
// unexpected keeps its provider error and is thrown to the caller.
export type WalletChainOutcome = 'ok' | 'switched' | 'rejected' | 'unknown_chain';

// Standard provider error codes this module branches on: 4001 user
// rejected the request, 4902 chain unrecognized (EIP-3326/EIP-3085 flow).
const CODE_USER_REJECTED = 4001;
const CODE_CHAIN_UNKNOWN = 4902;

// Reads window.ethereum defensively: absent window (SSR/tests), a locked
// or half-injected shim, or a non-provider value all degrade to null —
// the caller's UI then renders exactly what it did before wallets
// existed. The DOM lib types no `ethereum` field, hence the unknown hop.
export function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum;
  if (ethereum === null || typeof ethereum !== 'object') return null;
  const candidate = ethereum as Partial<EIP1193Provider>;
  if (
    typeof candidate.request !== 'function' ||
    typeof candidate.on !== 'function' ||
    typeof candidate.removeListener !== 'function'
  ) {
    return null;
  }
  return ethereum as EIP1193Provider;
}

// Provider liveness without a polling loop: read once on mount, then let
// the wallet's own chainChanged/accountsChanged events be the only
// refresh triggers (a locked wallet nulls accounts; a wallet injecting
// later is picked up on the next event or mount).
export function useInjectedProvider(): EIP1193Provider | null {
  const [provider, setProvider] = useState<EIP1193Provider | null>(() =>
    getInjectedProvider(),
  );

  useEffect(() => {
    const injected = getInjectedProvider();
    setProvider(injected);
    if (injected === null) return;
    const refresh = () => setProvider(getInjectedProvider());
    injected.on('chainChanged', refresh);
    injected.on('accountsChanged', refresh);
    return () => {
      injected.removeListener('chainChanged', refresh);
      injected.removeListener('accountsChanged', refresh);
    };
  }, []);

  return provider;
}

// The wallet's active chain as a number; null when eth_chainId fails or
// returns a non-hex shape (nothing is guessed from a broken answer).
export async function walletChainId(provider: EIP1193Provider): Promise<number | null> {
  try {
    const result = await provider.request({ method: 'eth_chainId' });
    if (typeof result !== 'string') return null;
    const parsed = Number.parseInt(result, 16);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// eth_requestAccounts: also the wallet-unlock prompt. Non-string entries
// are dropped rather than forwarded to the tx builder.
export async function requestAccounts(provider: EIP1193Provider): Promise<string[]> {
  const result = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(result)) return [];
  return result.filter((account): account is string => typeof account === 'string');
}

// eth_sendTransaction through the facade; returns the broadcast tx hash
// or throws the provider's own error untouched.
export async function sendWalletTransaction(
  provider: EIP1193Provider,
  tx: WalletTransactionRequest,
): Promise<string> {
  const result = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new Error(`wallet returned an unexpected transaction hash: ${safeStringify(result)}`);
  }
  return result;
}

// Walks the wallet onto `chainInfo`'s chain: no-op when already there,
// wallet_switchEthereumChain otherwise, and on 4902 a
// wallet_addEthereumChain built from the explorer's own chain metadata
// (name, native currency, default RPCs — viem-known chains carry them
// all). A chain the registry does not know cannot be described to the
// wallet honestly, so it reports 'unknown_chain' instead of sending a
// fabricated payload. User rejections map to 'rejected'; every other
// provider error is re-thrown with its message intact.
export async function ensureWalletChain(
  provider: EIP1193Provider,
  chainInfo: Chain | null,
): Promise<WalletChainOutcome> {
  if (chainInfo === null) return 'unknown_chain';

  const current = await walletChainId(provider);
  if (current === chainInfo.id) return 'ok';

  const chainId = `0x${chainInfo.id.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
    return 'switched';
  } catch (switchError) {
    if (providerErrorCode(switchError) === CODE_CHAIN_UNKNOWN) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId,
              chainName: chainInfo.name,
              // viem's nativeCurrency {name, symbol, decimals} is exactly
              // the EIP-3085 shape.
              nativeCurrency: chainInfo.nativeCurrency,
              rpcUrls: chainInfo.rpcUrls.default.http,
            },
          ],
        });
        // Wallets activate a chain they just added.
        return 'switched';
      } catch (addError) {
        if (providerErrorCode(addError) === CODE_USER_REJECTED) return 'rejected';
        throw addError;
      }
    }
    if (providerErrorCode(switchError) === CODE_USER_REJECTED) return 'rejected';
    throw switchError;
  }
}

// True when the provider error is the user's own rejection (code 4001) —
// a decision, not a failure, so callers keep it quiet.
export function isUserRejected(error: unknown): boolean {
  return providerErrorCode(error) === CODE_USER_REJECTED;
}

// Provider message verbatim for inline attribution — no swallowing into
// a generic label. Non-Error payloads stringify safely.
export function providerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  const stringified = safeStringify(error);
  return stringified === '' ? 'Unknown wallet error' : stringified;
}

function providerErrorCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

function safeStringify(value: unknown): string {
  try {
    const stringified = JSON.stringify(value);
    return stringified ?? String(value);
  } catch {
    return String(value);
  }
}
