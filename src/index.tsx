import { createRoot } from 'react-dom/client';
import { cx } from '@linaria/core';
import { lightTheme, spacing, typography } from 'haze-ui';
// tokens.css side-effect import: theme (--haze-* variables), spacing and
// typography baselines. All other component CSS is injected on demand by
// vite-plugin-haze-ui (vite plugin, devDependency) based on the module graph,
// so no manual per-component CSS list is needed.
import 'haze-ui/css/tokens.css';
// Global design language: imported after tokens.css so its scope-class
// overrides (doubled-specificity selectors, see file header) win regardless
// of CSS injection order.
import '@/theme.css';
import { ToastContainer } from 'haze-ui';
import App from '@/views';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DiscoveryGate } from '@/components/ServiceSetup';
import { ServiceDiscoveryProvider } from '@/hooks/ServiceDiscoveryContext';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';

// SPA route recovery for GitHub Pages 404 redirect
// 404.html encodes the original path into the hash (e.g. #/chain/1)
// We restore it to history before the router initializes
(function restoreSpaRoute() {
  const hash = window.location.hash;
  if (hash?.startsWith('#/')) {
    const route = hash.slice(2); // strip '#/'
    const base = import.meta.env.BASE_URL?.replace(/\/+$/, '') ?? '';
    const targetPath = `${base}/${route}`;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetPath);
    }
    // Clean up hash so the router sees a clean path
    window.location.hash = '';
  }
})();

function Root() {
  const { status, error, isScanning, setApiUrl, discover } = useServiceDiscovery();

  return (
    <div className={cx(lightTheme, spacing, typography)}>
      {/* Toast host above the router (painless pattern): every view — and
          the setup overlay — gets useToast coverage. */}
      <ToastContainer>
        {/* Degraded mode: when every discovery probe fails the app still
            renders (RPC-backed pages need no backend) with a dismissible
            banner + setup overlay. Only the first-run scan gates rendering. */}
        <DiscoveryGate
          status={status}
          error={error}
          isScanning={isScanning}
          setApiUrl={setApiUrl}
          discover={discover}
        >
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </DiscoveryGate>
      </ToastContainer>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container not found');
}

const root = createRoot(container);

// No StrictMode: native-router resolves the initial location once per mount
// and aborts superseded chains via their ctx.signal — StrictMode's
// double-effect mount aborts the real resolve, surfacing route-loaders as
// 'signal is aborted' error pages (template app runs without it for the
// same reason).
root.render(
  <ServiceDiscoveryProvider>
    <Root />
  </ServiceDiscoveryProvider>,
);
