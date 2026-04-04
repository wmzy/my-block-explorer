import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ServiceSetup } from '@/components/ServiceSetup';
import { useAutoDiscovery } from '@/hooks/useAutoDiscovery';
import 'haze-ui/styles.css';
import '@/styles/global';

function Root() {
  const { status, serviceInfo, error, isScanning, currentPort, setApiUrl, discover, reset } =
    useAutoDiscovery();

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
    <Root />
  </React.StrictMode>,
);
