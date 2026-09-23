import { useEffect } from 'react';
import { css } from '@linaria/core';
import {
  View,
  HistoryRouter as Router,
  createRoutes,
  useRouter,
  type RoutePaths,
} from '@native-router/react';
import { ConnectionStatus } from '@/components/ServiceSetup';
import { contractSourceLoader } from '@/services/dataloaders';
import { getChainName } from '@/config/chains';

import RouterError from './RouterError';
import NotFound from './NotFound';

// Flat route table: the route IS the page (no nested/parallel routes —
// independent UI sections are components, not routes). Views are lazy
// chunks; params/search are consumed via useMatched/useSearch in the views.
// `satisfies Route` semantics keep every `path` a string literal so the
// AppPaths union below stays narrow (an `as Route` cast would widen to
// string and kill TypedLink's compile-time path checking).
const routes = createRoutes({
  children: [
    {
      // Landing: dynamic target (remembered chain from localStorage, else
      // the preferred chain) with replace semantics, resolved at mount by
      // the Landing view instead of the old static /chain/1 redirect.
      path: '/',
      component: () => import('./Home/Landing'),
    },
    {
      path: '/chain/:chainId',
      component: () => import('./Home'),
    },
    {
      path: '/chain/:chainId/blocks',
      component: () => import('./Blocks/List'),
    },
    {
      path: '/chain/:chainId/transactions',
      component: () => import('./Transactions/List'),
    },
    {
      // The node's own transaction pool (txpool_content): live browser
      // RPC with an honest unsupported state when the endpoint keeps its
      // txpool private (most public RPCs do).
      path: '/chain/:chainId/pending',
      component: () => import('./Transactions/Pending'),
    },
    {
      // Cached-contract directory (the explorer's own contract_sources
      // rows): a plain list fetch, so no loader; the view owns ?q= and
      // ?offset=.
      path: '/chain/:chainId/contracts',
      component: () => import('./Contracts/List'),
    },
    {
      // Token lens over a contract address (self-guarding view: EOA /
      // delegated EOA / non-token contracts render dedicated in-page
      // cards, so no loader rejection is needed).
      path: '/chain/:chainId/token/:address',
      component: () => import('./Token'),
    },
    {
      // Daily chain charts from client-side RPC sampling (no backend, no
      // indexer claims — the page labels its own sampling basis).
      path: '/chain/:chainId/charts',
      component: () => import('./Charts'),
    },
    {
      path: '/chain/:chainId/block/:blockNumber',
      component: () => import('./Blocks/Detail'),
    },
    {
      path: '/chain/:chainId/tx/:txHash',
      component: () => import('./Transactions/Detail'),
    },
    {
      path: '/chain/:chainId/address/:address',
      component: () => import('./Address'),
    },
    {
      // Contract source is immutable once verified: the shared-cache loader
      // resolves it during navigation (skeleton below on cold start), and
      // the view's useContractSource hook then serves the loader-primed
      // cache entry without a second request. The /events subpath renders
      // the same view with a different default tab.
      path: '/chain/:chainId/contract/:address',
      data: contractSourceLoader,
      pendingComponent: ContractSkeleton,
      component: () => import('./Contract'),
    },
    {
      path: '/chain/:chainId/contract/:address/events',
      data: contractSourceLoader,
      pendingComponent: ContractSkeleton,
      component: () => import('./Contract'),
    },
    {
      path: '/search',
      component: () => import('./Search'),
    },
  ],
});

// Every route path as a literal union: TypedLink<AppPaths> narrows `to`,
// so path typos fail at compile time (dynamic paths additionally require
// a complete `params` object).
export type AppPaths = RoutePaths<typeof routes>;

// Exported for the structural route-table test (path set, landing
// redirect, loader wiring, path→view module resolution).
export { routes };

const skeleton = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  color: var(--haze-color-text-secondary);
`;

function ContractSkeleton() {
  return <div className={skeleton}>Loading contract information...</div>;
}

// Router baseUrl shares its source of truth with the vite base: an absolute
// base (GitHub Pages project deploy) becomes the match/navigation prefix;
// the dev default '/' strips to ''. Without this, a subpath-hosted SPA
// matches nothing and every deep link renders NotFound.
const routerBaseUrl = import.meta.env.BASE_URL.startsWith('/')
  ? import.meta.env.BASE_URL.slice(0, -1)
  : '';

const FALLBACK_TITLE = 'My Block Explorer';

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
const FALLBACK_DESCRIPTION =
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

// Idempotent meta-tag maintenance: finds the existing tag by its
// property/name attribute, creates it once when missing, then keeps the
// content in sync. Re-renders and re-syncs update in place — never a
// duplicate tag. (Static crawlers that never execute JS still see only the
// index.html head; these tags serve JS-executing clients and link
// unfurlers that do.)
const setMetaContent = (
  attribute: 'name' | 'property',
  key: string,
  content: string,
): void => {
  const tag =
    document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`) ??
    document.createElement('meta');
  if (!tag.isConnected) {
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

// Sets document.title and the share-card meta tags per route. `useMatched`
// is NOT usable at this level: the router provides the matched-route
// context only inside the resolved view tree, so this follows
// ScrollRestoration's sanctioned pattern instead — observe the router's own
// history (initial location + every push/replace/pop) and derive both the
// title and the description from the bare location.
// Exported for the harness test (mounted at the same Router-children
// position as in App below).
export function DocumentTitle() {
  const router = useRouter();

  useEffect(() => {
    const sync = () => {
      const { pathname, search } = router.history.location;
      const localPath =
        router.baseUrl !== '' && pathname.startsWith(router.baseUrl)
          ? pathname.slice(router.baseUrl.length)
          : pathname;
      const title = deriveDocumentTitle(localPath, search);
      document.title = title;
      setMetaContent('property', 'og:title', title);
      setMetaContent(
        'property',
        'og:description',
        deriveMetaDescription(localPath, search),
      );
      setMetaContent('property', 'og:type', 'website');
      setMetaContent('name', 'twitter:card', 'summary');
    };
    sync();
    return router.history.listen(sync);
  }, [router]);

  return null;
}

export default function App() {
  return (
    <Router
      routes={routes}
      baseUrl={routerBaseUrl}
      errorHandler={(error) => <RouterError error={error} />}
      notFound={NotFound}
    >
      <DocumentTitle />
      <View />
      <ConnectionStatus />
    </Router>
  );
}
