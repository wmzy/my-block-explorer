import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ServiceSetup } from '@/components/ServiceSetup';
import { ServiceDiscoveryProvider } from '@/hooks/ServiceDiscoveryContext';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import 'haze-ui/styles.css';
import '@/styles/global';

function Root() {
  const { status, serviceInfo, error, isScanning, currentPort, setApiUrl, discover, reset } =
    useServiceDiscovery();

  if (status !== 'found') {
    return (
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
    );
  }

  return <App />;
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
