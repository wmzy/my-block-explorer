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
import {
  deriveDocumentTitle,
  deriveMetaDescription,
} from '@/utils/metaDescribe';

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
      // Token directory: curated known tokens plus tokens opened in this
      // browser (localStorage), priced where DefiLlama resolves. An honest
      // directory — header copy never claims a complete registry.
      path: '/chain/:chainId/tokens',
      component: () => import('./Tokens/List'),
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
    {
      // SQL console: read-only admin-gated queries against the explorer's
      // MAIN DuckDB (every chain's indexed rows), so — unlike every other
      // data page — it is deliberately not chain-scoped and reads no
      // :chainId param; the view copy says so.
      path: '/sql',
      component: () => import('./Sql'),
    },
    {
      // Local ops overview for the operator: storage sizes, indexing/watch/
      // rate-limit status and backup guidance. Not chain-scoped (reads the
      // main DuckDB + the data/ directory), like the SQL console; its API
      // uses the opt-in admin tier so zero-config local sessions work.
      path: '/ops',
      component: () => import('./Ops'),
    },
    {
      // Signature lookup tool: resolve function selectors / event topic0
      // hashes (and name fragments where the backend supports it) through
      // the openchain-backed /api/signatures. Not chain-scoped.
      path: '/signatures',
      component: () => import('./Signatures'),
    },
    {
      // Static explainer for the data-coverage vocabulary the CoverageBadge
      // chips carry (linked from the badge's expanded detail): pure copy,
      // no loader, and deliberately not chain-scoped — the levels describe
      // data sourcing, which is the same on every chain.
      path: '/about/coverage',
      component: () => import('./Coverage/Legend'),
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

// Title/description derivations live in '@/utils/metaDescribe' — extracted
// verbatim so the server-side og-meta middleware (src/middleware/og-meta.ts,
// which serves the statically built SPA to JS-less requests) can derive the
// exact same strings without importing React or the router. Re-exported
// here to keep this module the single import site for existing consumers
// (DocumentTitle below and the tests).
export { deriveDocumentTitle, deriveMetaDescription };

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
