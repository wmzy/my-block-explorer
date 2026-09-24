import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { css } from '@linaria/core';
import { z } from 'zod';
import { Alert, Input } from 'haze-ui';
import { navigate } from '@native-router/core';
import { useRouter, useSearch, useSetSearch, TypedLink } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import TopNavigation from '@/components/TopNavigation';
import { getChainName } from '@/config/chains';
import {
  fetchChainSearch,
  fetchSearch,
  type SearchResult,
  type SupportedChainRef,
} from '@/services/search';
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import { isBackendUnreachable } from '@/util/http';
import {
  resolveEnsAddress,
  ensDestinations,
  type EnsDestinations,
} from '@/services/ensForward';
import { recordSearchHistoryEntry } from '@/services/searchHistory';
import { formatAddress } from '@/utils/format';
import { readRememberedChainId } from '@/views/Home/Landing';
import { degradedSearchMessage } from './degradedReasons';
import type { Block, Transaction, AddressInfo } from '@/types/blockchain';

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  // Chain context the header search forwards (the chain the user was on
  // when searching); the global endpoint echoes what it actually searched.
  chain: z.coerce.number().int().positive().optional().catch(undefined),
});

// Example searches are mainnet entities (a well-known address, an early
// mainnet transaction, a mainnet block), so they always run on mainnet —
// never in whatever chain the visitor last remembered.
const EXAMPLE_CHAIN_ID = 1;

const searchContainer = css`
  max-width: 600px;
  margin: 0 auto;
  padding: var(--haze-space-5);
`;

const searchForm = css`
  display: flex;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-6);

  /* Narrow screens: the input's intrinsic width + the Search button no
     longer fit one ~300px row — the button wraps to its own line. */
  @media (max-width: 768px) {
    flex-wrap: wrap;

    button {
      flex: 1 1 100%;
    }
  }
`;

const examples = css`
  margin-top: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const exampleBadges = css`
  margin-top: var(--haze-space-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-2);
`;

// Example badges are actions, not decoration: the wrapper span carries the
// interactive semantics (focus + keyboard activation) around the purely
// visual Badge, whose own props accept neither tabIndex nor key handlers.
const exampleBadgeAction = css`
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--haze-color-primary);
    outline-offset: 2px;
    border-radius: var(--haze-radius-sm);
  }
`;

const resultCard = css`
  margin-top: var(--haze-space-6);
`;

// Action row under a result notice (ENS destination choice, cross-chain
// retry): primary action first, alternates to its right.
const resultActions = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-3);
`;

// Prominent context line above results/suggestions: which chain the
// resolved search actually ran on.
const searchedOn = css`
  margin-top: var(--haze-space-4);
  padding: var(--haze-space-2) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
`;

const chainSelector = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-4);
`;

const chainOption = css`
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;

  &:hover {
    border-color: var(--haze-color-primary);
    background-color: var(--haze-color-bg-subtle);
  }

  /* Keyboard focus must be as visible as the hover affordance — the
     option is a div carrying button semantics, so the ring is the only
     non-pointer activation cue. */
  &:focus-visible {
    border-color: var(--haze-color-primary);
    outline: 2px solid var(--haze-color-primary);
    outline-offset: 2px;
  }
`;

const chainName = css`
  font-weight: var(--haze-weight-medium);
  margin-bottom: var(--haze-space-1);
`;

const chainId = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

const suggestionList = css`
  margin-top: var(--haze-space-3);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const suggestionLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;
  font-family: var(--haze-font-mono);
  overflow-wrap: anywhere;
  width: fit-content;

  &:hover {
    text-decoration: underline;
  }
`;

const chainFilterInput = css`
  margin-bottom: var(--haze-space-3);
`;

// Filter matched nothing within the (scoped) picker list: not a dead end —
// the copy explains how to reach the unlisted networks.
const chainEmpty = css`
  padding: var(--haze-space-4);
  text-align: center;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

// --- Local contracts section (free-text hits in this explorer's cache) ---

const localContractsNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin-bottom: var(--haze-space-3);
`;

const localContractsList = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

// One cached-contract hit: a full row link onto the hit's own chain page
// (each row carries its chain — an unscoped search may match several).
const localContractRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  text-decoration: none;
  color: var(--haze-color-text);

  &:hover {
    border-color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
  }
`;

const localContractName = css`
  font-weight: var(--haze-weight-medium);
`;

const localContractAddress = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const localContractChain = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin-left: auto;
`;

const exampleQueries = [
  {
    label: 'Address',
    value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    type: 'address',
  },
  {
    label: 'Tx Hash',
    value: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    type: 'hash',
  },
  { label: 'Block Number', value: '18000000', type: 'block' },
];

// Keyboard activation for non-button elements carrying button semantics
// (role="button" spans/divs): Enter and Space must trigger exactly like a
// click — Space would otherwise scroll the page.
const activateOnKey =
  (handler: () => void) =>
    (e: KeyboardEvent<HTMLElement>): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    };

// Renders backend suggestion lines, turning the actionable ones into
// TypedLinks on the suggestion chain's pages: 'Latest block number: N'
// links to block N, bare 0x-hex lines after 'Recent transactions:' link
// to the transaction page, and 'Latest block hash: …' reuses the block
// number from its sibling line (the block detail route only accepts
// numbers). The chain comes from the response itself (the chain the
// suggestions were resolved on) with the resolved search context as
// fallback; with NO chain at all every line stays inert text — linking
// to a guessed chain would send the user to the wrong network's pages.
const renderSuggestions = (suggestions: string[], chainId: number | null): ReactNode[] => {
  let inTxSection = false;
  let latestBlockNumber: string | null = null;

  return suggestions.map((line) => {
    // No chain context anywhere: inert text, never a link to a made-up
    // chain (the old hardcode linked these to mainnet).
    if (chainId === null) return <div key={line}>{line}</div>;

    const blockNumberMatch = line.match(/^Latest block number:\s*(\d+)$/);
    if (blockNumberMatch) {
      latestBlockNumber = blockNumberMatch[1];
      return (
        <TypedLink
          key={line}
          to={`/chain/${chainId}/block/${blockNumberMatch[1]}`}
          className={suggestionLink}
        >
          {line}
        </TypedLink>
      );
    }

    if (/^Latest block hash:\s*0x[a-fA-F0-9]{64}$/.test(line) && latestBlockNumber !== null) {
      return (
        <TypedLink
          key={line}
          to={`/chain/${chainId}/block/${latestBlockNumber}`}
          className={suggestionLink}
        >
          {line}
        </TypedLink>
      );
    }

    if (line === 'Recent transactions:') {
      inTxSection = true;
      return <div key={line}>{line}</div>;
    }

    if (inTxSection && /^0x[a-fA-F0-9]{64}$/.test(line)) {
      return (
        <TypedLink key={line} to={`/chain/${chainId}/tx/${line}`} className={suggestionLink}>
          {line}
        </TypedLink>
      );
    }

    inTxSection = false;
    return <div key={line}>{line}</div>;
  });
};

// Destination choice for a resolved ENS name: Ethereum (where the name
// resolved) is the primary action; the chain the search ran on is the
// secondary, shown only when it differs. The click is what history
// records — the chain actually opened, never a default.
function EnsDestinationButtons({
  destinations,
  onOpen,
}: {
  destinations: EnsDestinations;
  onOpen: (chainId: number) => void;
}) {
  const { primaryChainId, alternateChainId } = destinations;
  return (
    <div className={resultActions}>
      <Button variant="primary" onClick={() => onOpen(primaryChainId)}>
        Open on {getChainName(primaryChainId)}
      </Button>
      {alternateChainId !== null && (
        <Button variant="outline" onClick={() => onOpen(alternateChainId)}>
          on {getChainName(alternateChainId)}
        </Button>
      )}
    </div>
  );
}

export default function Search() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  // Search-submit failure. The message is the user-facing copy; onRetry is
  // set only for failures a retry can actually cure (backend-unreachable),
  // so the Retry button never sits on a dead end.
  const [error, setError] = useState<{ message: string; onRetry?: () => void } | null>(null);
  const [chainFilter, setChainFilter] = useState('');
  // Successful client-side ENS resolution, presented as a destination
  // choice: the address is a fact of Ethereum (resolution happens there),
  // and the user picks where to view it — Ethereum by default, the chain
  // the search ran on as the alternate. No navigation happens until that
  // choice, and history records the destination actually opened.
  const [ensResolution, setEnsResolution] = useState<{
    name: string;
    address: string;
    destinations: EnsDestinations;
  } | null>(null);
  // Failed ENS lookup, split by cause. 'not-found' is a definitive answer
  // (the name is not registered on Ethereum); 'rpc-error' means the
  // Ethereum RPC never answered and is offered as a retry; 'no-rpc' means
  // this explorer has no usable Ethereum RPC endpoint — missing
  // configuration, so no retry is offered. chainContext is kept so Retry
  // re-runs the exact same search.
  const [ensError, setEnsError] = useState<{
    name: string;
    kind: 'rpc-error' | 'no-rpc' | 'not-found';
    chainContext?: number | null;
  } | null>(null);
  // Chain the current result actually ran on (echoed by the global
  // endpoint, inherent to the per-chain one). Drives the 'Searched on'
  // line, the URL chain param and the TopNavigation context.
  const [resolvedChainId, setResolvedChainId] = useState<number | null>(null);
  const router = useRouter();
  const setSearch = useSetSearch(searchSchema);
  const { q: qParam, chain } = useSearch(searchSchema);
  // The (query, chain) pair the result on screen was produced by. The
  // deep-link effect consumes a URL state exactly once by comparing
  // against it: a later ?q=/?chain= change (header search on this page,
  // the header miss notice's 'Choose a network' escape) re-runs the
  // search, while the view's own URL writes record their pair first and
  // never re-trigger.
  const lastConsumedRef = useRef<{ q: string; chain: number | null } | null>(null);

  // ENS names resolve in the browser against a mainnet client (that is
  // where the ENS registry lives). Not-found, RPC failure and missing RPC
  // configuration are distinct outcomes with distinct copy — only the RPC
  // failure is retryable. A success is held as a destination choice (see
  // ensResolution), never navigated or recorded on its own.
  const resolveEnsName = async (name: string, chainContext?: number | null): Promise<void> => {
    const outcome = await resolveEnsAddress(name);

    if (outcome.status === 'not-found') {
      setEnsError({ name, kind: 'not-found', chainContext });
      return;
    }
    if (outcome.status === 'failed') {
      setEnsError({ name, kind: 'rpc-error', chainContext });
      return;
    }
    if (outcome.status === 'no-rpc') {
      setEnsError({ name, kind: 'no-rpc', chainContext });
      return;
    }

    setEnsResolution({
      name,
      address: outcome.address,
      destinations: ensDestinations(chainContext ?? undefined),
    });
  };

  // Opens a resolved ENS address on the chain the user chose — the moment
  // history records the entry, with the destination actually opened (not
  // the chain the search happened to run on).
  const openEnsResolution = (destinationChainId: number) => {
    if (!ensResolution) return;
    const { name, address } = ensResolution;
    recordSearchHistoryEntry(name, destinationChainId);
    setEnsResolution(null);
    navigate(router, `/chain/${destinationChainId}/address/${address}`).catch(() => undefined);
  };

  // pinnedChainId: an explicitly pinned chain (example searches, a chain
  // switch from the header) — or null to force "no chain context" (the
  // cross-chain retry), which must not fall back to the ?chain= param the
  // URL still carries.
  const handleSearch = async (searchQuery = query, pinnedChainId?: number | null) => {
    // Only truly empty input is rejected here: free text ('unknown' after
    // sanitize/detect) still goes to the global endpoint, which runs the
    // searchAll pass and answers with suggestions instead of a dead end.
    if (!searchQuery.trim()) return;

    const sanitized = sanitizeInput(searchQuery.trim());
    const searchType = detectSearchType(sanitized);

    // Explicit chain context, always: an explicitly pinned chain (example
    // searches, a chain switch from the header, null from the cross-chain
    // retry), else the ?chain= param the header search forwards.
    // Chain-relative queries (transaction/block hashes, block numbers)
    // stop there: they are facts of exactly one chain, and guessing the
    // remembered one would turn a wrong guess into a false "no results" —
    // with no explicit context they go to the global endpoint unscoped and
    // come back as needsChain (network picker). Everything else
    // (addresses, ENS, free text) additionally falls back to the chain
    // remembered by the Landing view — there the chain is only a viewing
    // choice, and the header shows it.
    const explicitChain = pinnedChainId === undefined ? chain : pinnedChainId;
    const chainRelative = searchType === 'hash' || searchType === 'block';
    const chainContext = chainRelative
      ? explicitChain
      : explicitChain ?? readRememberedChainId();

    setIsSearching(true);
    setError(null);
    setResult(null);
    setEnsResolution(null);
    setEnsError(null);
    setResolvedChainId(null);
    // Record the (query, chain) pair this search consumes before any
    // await: once the URL syncs to it below, the deep-link effect must
    // treat it as already-run, and a re-render mid-flight must not
    // double-fire the same pair.
    lastConsumedRef.current = {
      q: sanitized,
      chain: pinnedChainId === undefined ? (chain ?? null) : pinnedChainId,
    };

    try {
      // ENS names never hit the backend: detection is local and resolution
      // happens in the browser (see resolveEnsName); history is recorded
      // by openEnsResolution, once the user opens a destination.
      if (searchType === 'ens') {
        await resolveEnsName(sanitized, chainContext);
        return;
      }

      // A pinned chain resolves directly on the per-chain endpoint; every
      // other search (including the deliberately unpinned cross-chain
      // retry, pinnedChainId === null) goes through the global endpoint
      // with the chain context as ?chainId= — for hash/block queries that
      // hint makes the endpoint resolve on exactly that chain, so a search
      // from a page with chain context goes straight to the entity.
      // Without a hint the endpoint answers hash/block queries with
      // needsChain and the network picker below takes over.
      const searchResult = typeof pinnedChainId === 'number'
        ? await fetchChainSearch(pinnedChainId, sanitized)
        : await fetchSearch(sanitized, chainContext ?? undefined);
      if (!searchResult) return;

      setResult(searchResult);

      // The chain this search actually ran on. needsChain responses
      // deliberately have none — the endpoint refused to pick a chain, so
      // the view must not claim one (no 'Searched on', no URL chain, no
      // history entry).
      const searchedChain = searchResult.needsChain
        ? null
        : (pinnedChainId ?? searchResult.searchedChainId ?? chainContext ?? null);

      // Found results leave for the entity's page right away — record the
      // history entry but skip the URL sync: two overlapping navigations
      // (setSearch replace + the entity-page push) race and the replace
      // would strand the user on /search.
      const navigatingToResult = searchResult.found
        && searchResult.data !== undefined
        && (searchResult.type === 'address'
          || searchResult.type === 'transaction'
          || searchResult.type === 'block');

      if (searchedChain !== null) {
        setResolvedChainId(searchedChain);
        recordSearchHistoryEntry(sanitized, searchedChain);
        if (!navigatingToResult) {
          // The URL pair changes here (the resolved chain may differ from
          // ?chain=) — record the synced pair so the effect does not
          // mistake the view's own write for a fresh deep link.
          lastConsumedRef.current = { q: sanitized, chain: searchedChain };
          // Reflect the resolved chain into the URL (replacing the current
          // entry): the page now has a concrete chain context even when it
          // was opened without ?chain=. Search params are strings on the
          // wire; the schema's z.coerce.number() parses it back on read.
          void setSearch({ q: sanitized, chain: String(searchedChain) }, { replace: true });
        }
      }

      // Navigate on the chain the endpoint actually searched when it says
      // so (searchedChainId); the payload's own chainId is only a fallback.
      if (searchResult.found && searchResult.type === 'address' && searchResult.data) {
        const data = searchResult.data as AddressInfo;
        const targetChain = searchedChain ?? data.chainId;
        navigate(router, `/chain/${targetChain}/address/${data.address}`).catch(
          () => undefined,
        );
      } else if (searchResult.found && searchResult.type === 'transaction' && searchResult.data) {
        const data = searchResult.data as Transaction;
        const targetChain = searchedChain ?? data.chainId;
        navigate(router, `/chain/${targetChain}/tx/${data.hash}`).catch(() => undefined);
      } else if (searchResult.found && searchResult.type === 'block' && searchResult.data) {
        const data = searchResult.data as Block;
        const targetChain = searchedChain ?? data.chainId;
        navigate(router, `/chain/${targetChain}/block/${data.number}`).catch(() => undefined);
      }
    } catch (err) {
      // No HTTP response at all (backend offline / not connected) gets the
      // attribution copy plus a Retry that re-runs this exact search; any
      // other failure keeps its own message. Neither is ever worded as
      // "no results".
      setError(
        isBackendUnreachable(err)
          ? {
              message: 'Search unavailable — cannot reach the explorer backend',
              onRetry: () => void handleSearch(searchQuery, pinnedChainId),
            }
          : { message: err instanceof Error ? err.message : 'Search failed' },
      );
    } finally {
      setIsSearching(false);
    }
  };

  // Deep link: ?q=<query> prefills the input and runs the search — on
  // mount AND on every later URL change while the view stays mounted: a
  // header search from this page (TopNavigation navigates to
  // /search?q=new) or the header miss notice's 'Choose a network' escape
  // (drops ?chain= so the global endpoint answers with the picker). The
  // guard is the last-consumed (q, chain) pair, not a one-shot flag: a
  // pair equal to what produced the current result is a no-op (no
  // duplicate search), anything else re-runs. handleSearch is
  // intentionally left out of the deps — it is recreated every render and
  // re-running the search would loop. It records its own consumed pair,
  // so the URL sync of a manually typed query never re-triggers this
  // effect either.
  useEffect(() => {
    if (!qParam) return;
    const consumed = lastConsumedRef.current;
    const urlPair = { q: qParam, chain: chain ?? null };
    if (consumed !== null && consumed.q === urlPair.q && consumed.chain === urlPair.chain) return;
    lastConsumedRef.current = urlPair;
    setQuery(qParam);
    void handleSearch(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam, chain]);

  const handleChainSelect = async (selectedChainId: number) => {
    if (!query.trim()) return;

    const sanitized = sanitizeInput(query.trim());
    // This search consumes exactly the (query, picked chain) pair — record
    // it up front so the miss-path URL sync below (and the effect run it
    // causes) is not mistaken for a fresh deep link.
    lastConsumedRef.current = { q: sanitized, chain: selectedChainId };
    setIsSearching(true);
    setError(null);

    try {
      const searchResult = await fetchChainSearch(selectedChainId, sanitized);
      if (!searchResult) return;

      // The search ran on the picked chain — claim it (resolved context,
      // history entry) only now that the fetch came back: a failed
      // request (the catch below) never claims a chain, records history
      // or touches the URL.
      setResolvedChainId(selectedChainId);
      recordSearchHistoryEntry(sanitized, selectedChainId);

      if (!searchResult.found || !searchResult.data) {
        // A data-source error is not a definitive miss — say so instead of
        // reporting "no results". Staying on /search: the URL gains the
        // picked chain so the page's context is explicit.
        void setSearch({ q: sanitized, chain: String(selectedChainId) }, { replace: true });
        setError({
          message: searchResult.degraded
            ? degradedSearchMessage(searchResult.degradedReasons)
            : `No results found on ${getChainName(selectedChainId)}`,
        });
        return;
      }

      const chainId = searchResult.chainId ?? selectedChainId;

      if (searchResult.type === 'address') {
        navigate(router, `/chain/${chainId}/address/${sanitized}`).catch(() => undefined);
      } else if (searchResult.type === 'transaction') {
        const data = searchResult.data as Transaction;
        navigate(router, `/chain/${chainId}/tx/${data.hash}`).catch(() => undefined);
      } else if (searchResult.type === 'block') {
        // Navigate by block number — the detail route only accepts numbers,
        // and the query itself may have been a block hash.
        const data = searchResult.data as Block;
        navigate(router, `/chain/${chainId}/block/${data.number}`).catch(() => undefined);
      }
    } catch (err) {
      // Same attribution as the global search: an unreachable backend is
      // the environment, not the picked chain — the Retry re-runs the
      // search on the chain the user had just chosen.
      setError(
        isBackendUnreachable(err)
          ? {
              message: 'Search unavailable — cannot reach the explorer backend',
              onRetry: () => void handleChainSelect(selectedChainId),
            }
          : { message: err instanceof Error ? err.message : 'Search failed' },
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    void handleSearch(example, EXAMPLE_CHAIN_ID);
  };

  // A chain-relative miss is only a fact of the chain it ran on — the
  // same hash may well live on another network. This drops the chain
  // constraint (URL param and resolved context) and re-runs the query
  // unscoped, which the global endpoint answers with needsChain: the
  // network picker takes over instead of a dead end.
  const handleTryAnotherNetwork = async () => {
    if (!query.trim()) return;
    const sanitized = sanitizeInput(query.trim());
    setResolvedChainId(null);
    void setSearch({ q: sanitized }, { replace: true });
    await handleSearch(sanitized, null);
  };

  // The header reflects the page's chain context: the chain the current
  // search resolved on, else the ?chain= param, else the remembered chain.
  const navChainId = resolvedChainId ?? chain ?? readRememberedChainId() ?? 1;

  // Switching chains from the header re-runs the current query on the new
  // chain (replacing the history entry, same as every in-app chain hop) —
  // with no query it just becomes the context for the next search.
  const handleNavChainChange = (newChainId: number) => {
    setResolvedChainId(newChainId);
    if (query.trim()) {
      void handleSearch(query, newChainId);
    } else {
      // No query to re-run, but the URL write below must not be mistaken
      // for a deep link either: record the pair it will produce.
      lastConsumedRef.current = { q: qParam ?? '', chain: newChainId };
      void setSearch(
        { ...(qParam ? { q: qParam } : {}), chain: String(newChainId) },
        { replace: true },
      );
    }
  };

  // Picker options come from the backend's own supported-chain list (the
  // needsChain response) — the exact set its route validation accepts — so
  // the picker can never offer a chain the backend would reject with a raw
  // 400. The list arrives pre-scoped (scope: 'popular' — the curated
  // popular set, not the full viem universe) and each entry carries its
  // native symbol, which the typed filter matches alongside name/ID.
  const allChains: SupportedChainRef[] = result?.supportedChains ?? [];
  const filteredChainRefs = useMemo(() => {
    const filter = chainFilter.trim().toLowerCase();
    if (!filter) return null;
    return allChains.filter(
      c => c.name.toLowerCase().includes(filter)
        || String(c.chainId).includes(filter)
        || c.symbol.toLowerCase().includes(filter),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainFilter, result]);
  const visibleChains = filteredChainRefs ?? allChains;

  // Additive free-text field of the global endpoint (LocalContractHit in
  // services/contractDirectory): present only when the query was free
  // text, absent from hash/block/ens/address responses. Typed through an
  // intersection because the shared SearchResult keeps its lean shape for
  // the entity-specific consumers.
  const localContracts = (result)
    ?.localContracts;

  // Curated token/label hits from the same additive free-text contract
  // (SearchService's tokenHits): known-token symbol matches plus this
  // explorer's own labels; each hit links to its own chain.
  const tokenHits = result?.tokenHits;

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <div className={searchContainer}>
        <Card>
          <CardHeader>
            <CardTitle>Blockchain Search</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSearch();
              }}
              className={searchForm}
            >
              <Input
                placeholder="Enter address, tx hash, or block number..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <Button
                loading={isSearching}
                disabled={!query.trim() || isSearching}
                // haze-ui buttons are hard-wired to type="button", so a
                // click never submits the enclosing form — it needs its own
                // handler (Enter in the input still goes through onSubmit).
                onClick={() => void handleSearch()}
              >
                Search
              </Button>
            </form>

            <div className={examples}>
              <div>Example searches:</div>
              <div className={exampleBadges}>
                {exampleQueries.map((example, index) => (
                  <span
                    key={index}
                    role="button"
                    tabIndex={0}
                    className={exampleBadgeAction}
                    onClick={() => handleExampleClick(example.value)}
                    onKeyDown={activateOnKey(() => handleExampleClick(example.value))}
                  >
                    <Badge variant="default">{example.label}</Badge>
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chain context of the resolved search — the page never silently
            searches a remembered chain without saying which one. */}
        {resolvedChainId !== null && (
          <div className={searchedOn}>Searched on {getChainName(resolvedChainId)}</div>
        )}

        {/* Local cache hits (free-text queries only): cached contract
            names matching the query ON THIS EXPLORER. Above the
            remote/degraded result cards — these are the explorer's own
            verified data — and rendered not at all when the response
            carries no hits. */}
        {localContracts !== undefined && localContracts.length > 0 && (
          <div className={resultCard}>
            <Card>
              <CardHeader>
                <CardTitle>Local contracts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={localContractsNote}>
                  Matching your locally cached sources — open a contract page to cache more.
                </p>
                <div className={localContractsList}>
                  {localContracts.map(hit => (
                    <TypedLink
                      key={`${hit.chainId}-${hit.address}`}
                      to={`/chain/${hit.chainId}/contract/${hit.address}`}
                      className={localContractRow}
                    >
                      <span className={localContractName}>
                        {hit.name ?? 'Unnamed contract'}
                      </span>
                      <span className={localContractAddress}>{hit.address}</span>
                      {hit.isVerified ? (
                        <Badge variant="success" size="sm">
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm">
                          Unverified
                        </Badge>
                      )}
                      <span className={localContractChain}>{getChainName(hit.chainId)}</span>
                    </TypedLink>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Curated token/label hits (free-text queries only): known-token
            symbols from the curated list and this explorer's own labels —
            an honest curated subset, never presented as a token index
            (the note says so). Known-token rows link to the token page,
            label rows to the address page, each on its own chain. Not
            rendered at all when the response carries no hits. */}
        {tokenHits !== undefined && tokenHits.length > 0 && (
          <div className={resultCard}>
            <Card>
              <CardHeader>
                <CardTitle>Known tokens &amp; labels (curated)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={localContractsNote}>
                  Curated known tokens and your labels — not every token on this chain.
                </p>
                <div className={localContractsList}>
                  {tokenHits.map(hit => (
                    <TypedLink
                      key={`${hit.chainId}-${hit.address}`}
                      to={hit.source === 'known-token'
                        ? `/chain/${hit.chainId}/token/${hit.address}`
                        : `/chain/${hit.chainId}/address/${hit.address}`}
                      className={localContractRow}
                    >
                      <span className={localContractName}>{hit.matchText}</span>
                      <span className={localContractAddress}>{hit.address}</span>
                      <Badge variant="default" size="sm">
                        {hit.source === 'known-token' ? 'Known token' : 'Label'}
                      </Badge>
                      <span className={localContractChain}>{getChainName(hit.chainId)}</span>
                    </TypedLink>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {error && (
          <ErrorState message={error.message} onRetry={error.onRetry} className={resultCard} />
        )}

        {ensResolution && (
          <div className={resultCard}>
            {/* Resolution provenance is stated ("on Ethereum") — the
                address is a fact there, everything else is a viewing
                choice made explicit below. */}
            <Alert variant="success">
              Resolved {ensResolution.name} → {formatAddress(ensResolution.address)} on Ethereum
            </Alert>
            <EnsDestinationButtons
              destinations={ensResolution.destinations}
              onOpen={openEnsResolution}
            />
          </div>
        )}

        {ensError && (
          <div className={resultCard}>
            {ensError.kind === 'rpc-error'
              ? (
                  <ErrorState
                    message={`ENS resolution failed for "${ensError.name}" — Ethereum RPC did not answer`}
                    onRetry={() => void handleSearch(ensError.name, ensError.chainContext)}
                  />
                )
              : ensError.kind === 'no-rpc'
                ? (
                    // Missing configuration, not a transient outage: no
                    // Retry — re-running cannot conjure an RPC endpoint.
                    <ErrorState
                      message={`ENS resolution unavailable for "${ensError.name}" — this explorer has no Ethereum RPC endpoint configured`}
                    />
                  )
                : (
                    <ErrorState
                      message={`ENS name "${ensError.name}" not found (checked on Ethereum)`}
                    />
                  )}
          </div>
        )}

        {result && !result.found && !result.needsChain && result.degraded && (
          <div className={resultCard}>
            {/* Not-found + degraded means an upstream lookup errored: say
                which lookups did not answer (the response's own reasons,
                humanized) and offer a retry instead of a definitive
                "No results". */}
            <ErrorState
              message={degradedSearchMessage(result.degradedReasons)}
              onRetry={() => handleSearch(result.query ?? query)}
            />
            {(result.type === 'transaction' || result.type === 'block') && (
              <Button
                variant="outline"
                className={resultActions}
                onClick={() => void handleTryAnotherNetwork()}
              >
                Try another network
              </Button>
            )}
          </div>
        )}

        {result && !result.found && !result.needsChain && !result.degraded && (
          <div className={resultCard}>
            <ErrorState
              message={
                result.message ?? `No results found for "${result.query ?? query}"`
              }
            />
            {result.suggestions && result.suggestions.length > 0 && (
              <div className={suggestionList}>
                {/* The chain the suggestions themselves name wins (it is
                    the chain the backend actually resolved their data on);
                    the resolved search context is the fallback. With
                    neither, renderSuggestions keeps every line as inert
                    text rather than linking to a guessed chain. */}
                {renderSuggestions(
                  result.suggestions,
                  result.suggestionsChainId ?? resolvedChainId ?? null,
                )}
              </div>
            )}
            {/* A chain-relative miss (tx/block hash, block number) is only
                a fact of the chain it ran on — offer the network picker
                again instead of a dead end. */}
            {(result.type === 'transaction' || result.type === 'block') && (
              <Button
                variant="outline"
                className={resultActions}
                onClick={() => void handleTryAnotherNetwork()}
              >
                Try another network
              </Button>
            )}
          </div>
        )}

        {result?.needsChain && result.supportedChains && (
          <Card className={resultCard}>
            <CardHeader>
              {/* The heading names the response's own curation scope. */}
              <CardTitle>
                {result.scope === 'popular' ? 'Popular networks' : 'Select Network'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={css`
                  color: var(--haze-color-text-secondary);
                  margin-bottom: var(--haze-space-4);
                `}
              >
                Please select a blockchain network to search:
              </p>

              <div className={chainFilterInput}>
                <Input
                  placeholder="Filter networks by name, ID, or symbol..."
                  value={chainFilter}
                  onChange={e => setChainFilter(e.target.value)}
                />
              </div>

              {visibleChains.length === 0 ? (
                // The (scoped) list has no match for the filter — not a
                // dead end: unlisted networks are reachable directly via
                // their own chain URL.
                <div className={chainEmpty}>
                  No network here matches &quot;{chainFilter.trim()}&quot;. Other networks
                  are not listed in this picker — open them directly at
                  /chain/&lt;chain-id&gt;.
                </div>
              ) : (
                <div className={chainSelector}>
                  {visibleChains.map(chain => (
                    <div
                      key={chain.chainId}
                      role="button"
                      tabIndex={0}
                      className={chainOption}
                      onClick={() => handleChainSelect(chain.chainId)}
                      onKeyDown={activateOnKey(() => handleChainSelect(chain.chainId))}
                    >
                      <div className={chainName}>{chain.name}</div>
                      <div className={chainId}>
                        Chain ID:
                        {chain.chainId}
                        {' '}• {chain.symbol}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
