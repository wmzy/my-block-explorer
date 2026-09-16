import { css } from '@linaria/core';
import {
  View,
  HistoryRouter as Router,
  createRoutes,
  type RoutePaths,
} from '@native-router/react';
import { ConnectionStatus } from '@/components/ServiceSetup';
import { contractSourceLoader } from '@/services/dataloaders';

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
      // Landing redirect, replace semantics preserved from the old
      // <Navigate to="/chain/1" replace /> entry route.
      path: '/',
      redirect: { path: '/chain/1', replace: true },
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

export default function App() {
  return (
    <Router
      routes={routes}
      baseUrl={routerBaseUrl}
      errorHandler={(error) => <RouterError error={error} />}
      notFound={NotFound}
    >
      <View />
      <ConnectionStatus />
    </Router>
  );
}
