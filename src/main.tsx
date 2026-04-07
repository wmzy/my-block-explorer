import React from 'react';
import { createRoot } from 'react-dom/client';
import { cx } from '@linaria/core';
import { lightTheme, spacing, typography } from 'haze-ui';
import { App } from './App';
import { ServiceSetup } from '@/components/ServiceSetup';
import { ServiceDiscoveryProvider } from '@/hooks/ServiceDiscoveryContext';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import { hazeThemeWrapper } from '@/styles/global';
import 'haze-ui/styles.css';
import '@/styles/global';

// SPA route recovery for GitHub Pages 404 redirect
// 404.html encodes the original path into the hash (e.g. #/chain/1)
// We restore it to history before React Router initializes
(function restoreSpaRoute() {
  const hash = window.location.hash;
  if (hash?.startsWith('#/')) {
    const route = hash.slice(2); // strip '#/'
    const base = import.meta.env.BASE_URL?.replace(/\/+$/, '') ?? '';
    const targetPath = `${base}/${route}`;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetPath);
    }
    // Clean up hash so React Router sees a clean path
    window.location.hash = '';
  }
})();

function Root() {
  const { status, serviceInfo, error, isScanning, currentPort, setApiUrl, discover, reset } =
    useServiceDiscovery();

  return (
    <div className={cx(hazeThemeWrapper, lightTheme, spacing, typography)}>
      {status !== 'found' ? (
        <ServiceSetup
          status={status}
          serviceInfo={serviceInfo}
          error={error}
          isScanning={isScanning}
          currentPort={currentPort}
          setApiUrl={setApiUrl}
          discover={discover}
          reset={reset}
        />
      ) : (
        <App />
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container not found');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ServiceDiscoveryProvider>
      <Root />
    </ServiceDiscoveryProvider>
  </React.StrictMode>,
);
