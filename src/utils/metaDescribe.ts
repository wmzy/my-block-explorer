// Document-title and share-card meta derivations, shared by the client
// (DocumentTitle in src/views/index.tsx) and the server-side og-meta
// middleware (src/middleware/og-meta.ts) so JS-less requests (crawlers,
// link unfurlers) and hydrated clients see the SAME strings.
//
// This module MUST stay free of React/router/browser imports — it is
// evaluated in Node by the standalone server. Its only dependency is the
// chain registry (pure viem chain metadata). The functions were extracted
// verbatim from src/views/index.tsx; the view file re-exports them so
// existing import paths keep working.

import { getChainName } from '../config/chains';

export const FALLBACK_TITLE = 'My Block Explorer';

// 10 chars = the 0x prefix + 8 nibbles: enough to identify a hash in a tab
// title while staying narrow.
const shortHash = (value: string): string => `${value.slice(0, 10)}…`;

// Tab title per route, derived from the bare location (no router context
// needed — one pure function per URL shape, unit-testable without a
// harness). Unknown shapes keep the static index.html title.
export function deriveDocumentTitle(pathname: string, search: string): string {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'search') {
    // The /search route carries its viewing chain in ?chain= (the context
    // the header search forwards); without it the generic suffix stands.
    const chainParam = new URLSearchParams(search).get('chain');
    const chainId = chainParam !== null ? Number.parseInt(chainParam, 10) : Number.NaN;
    return Number.isFinite(chainId)
      ? `Search · ${getChainName(chainId)}`
      : 'Search · Explorer';
  }

  // Static coverage explainer: exact shape only — deeper /about/* paths are
  // unknown shapes and keep the fallback.
  if (segments[0] === 'about' && segments[1] === 'coverage' && segments.length === 2) {
    return `Data Coverage — ${FALLBACK_TITLE}`;
  }

  if (segments[0] !== 'chain' || segments.length < 2) return FALLBACK_TITLE;

  const chainId = Number.parseInt(segments[1], 10);
  if (!Number.isFinite(chainId)) return FALLBACK_TITLE;
  const chainName = getChainName(chainId);

  switch (segments[2]) {
    case undefined:
      return `${chainName} Explorer`;
    case 'blocks':
      return `${chainName} Blocks`;
    case 'transactions':
      return `${chainName} Transactions`;
    case 'pending':
      return `Pending Transactions · ${chainName}`;
    case 'contracts':
      return `${chainName} Contracts`;
    case 'charts':
      return `${chainName} Charts`;
    case 'block':
      return segments[3] ? `Block #${segments[3]} · ${chainName}` : FALLBACK_TITLE;
    case 'tx':
      return segments[3] ? `Tx ${shortHash(segments[3])} · ${chainName}` : FALLBACK_TITLE;
    case 'address':
      return segments[3] ? `Address ${shortHash(segments[3])} · ${chainName}` : FALLBACK_TITLE;
    case 'token':
      return segments[3] ? `Token ${shortHash(segments[3])} · ${chainName}` : FALLBACK_TITLE;
    case 'contract':
      // The /events subpath shares the plain contract title.
      return segments[3] ? `Contract ${shortHash(segments[3])} · ${chainName}` : FALLBACK_TITLE;
    default:
      return FALLBACK_TITLE;
  }
}

// Share blurb for routes the title cannot describe alone (og:description /
// twitter card source). Same bare-location derivation as the title: each
// route family names its entity and chain; unknown shapes fall back to the
// generic explorer blurb. A malformed chainId still keeps the family's
// blurb with "the chain" in the noun slot — the family (tx/address/…) is
// recognizable from the path alone, so a shared link keeps a meaningful
// description instead of the generic fallback.
export const FALLBACK_DESCRIPTION =
  'A modern blockchain explorer for Ethereum and compatible networks — blocks, transactions, addresses and contracts.';

export function deriveMetaDescription(pathname: string, search: string): string {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'search') {
    const chainParam = new URLSearchParams(search).get('chain');
    const chainId = chainParam !== null ? Number.parseInt(chainParam, 10) : Number.NaN;
    return Number.isFinite(chainId)
      ? `Search blocks, transactions, addresses and contracts on ${getChainName(chainId)}.`
      : 'Search blocks, transactions, addresses and contracts across chains.';
  }

  if (segments[0] === 'about' && segments[1] === 'coverage' && segments.length === 2) {
    return 'What the data-coverage levels — live, cached, discovered, sampled, partial and unavailable — mean in this explorer, and why its numbers can differ from full-indexer explorers.';
  }

  if (segments[0] !== 'chain' || segments.length < 2) return FALLBACK_DESCRIPTION;

  const chainId = Number.parseInt(segments[1], 10);
  const chainNoun = Number.isFinite(chainId) ? getChainName(chainId) : 'the chain';

  switch (segments[2]) {
    case undefined:
      return `Explore ${chainNoun}: latest blocks, transactions, gas and chain stats.`;
    case 'blocks':
      return `Browse the latest blocks on ${chainNoun}.`;
    case 'transactions':
      return `Browse the latest transactions on ${chainNoun}.`;
    case 'pending':
      return `Pending (unconfirmed) transactions in this node's transaction pool on ${chainNoun}.`;
    case 'contracts':
      return `Browse the explorer's cached contracts on ${chainNoun}.`;
    case 'charts':
      return `Daily chain charts for ${chainNoun} — blocks per day, block time, gas usage and gas prices (sampled from RPC).`;
    case 'block':
      return segments[3]
        ? `View block #${segments[3]} on ${chainNoun} — transactions, gas used and more.`
        : FALLBACK_DESCRIPTION;
    case 'tx':
      return segments[3]
        ? `View transaction ${shortHash(segments[3])} on ${chainNoun} — block, gas, status and decoded calls.`
        : FALLBACK_DESCRIPTION;
    case 'address':
      return segments[3]
        ? `View address ${shortHash(segments[3])} on ${chainNoun} — balance, nonce, transactions and token holdings.`
        : FALLBACK_DESCRIPTION;
    case 'token':
      return segments[3]
        ? `View token ${shortHash(segments[3])} on ${chainNoun} — overview, transfers, holders and mint/burn totals.`
        : FALLBACK_DESCRIPTION;
    case 'contract':
      // The /events subpath shares the plain contract blurb.
      return segments[3]
        ? `View contract ${shortHash(segments[3])} on ${chainNoun} — source, ABI, events and interaction.`
        : FALLBACK_DESCRIPTION;
    default:
      return FALLBACK_DESCRIPTION;
  }
}

// True when the derivations can name this location — i.e. either string
// differs from its generic fallback. The og-meta middleware uses this to
// decide which HTML navigations deserve injected meta; everything else
// keeps the static index.html placeholders.
export function isDerivableMetaPath(pathname: string, search: string): boolean {
  return (
    deriveDocumentTitle(pathname, search) !== FALLBACK_TITLE ||
    deriveMetaDescription(pathname, search) !== FALLBACK_DESCRIPTION
  );
}
