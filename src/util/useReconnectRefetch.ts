import { useState } from 'react';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';

/**
 * Backend-offline recovery idiom shared by the views that render
 * BackendOfflineState: a plain Retry fast-fails while the API base is
 * unset, so the button re-runs service discovery first and fires
 * `onReconnected` only once a backend actually answers. The guard flag
 * makes the async handler re-entrant-safe and doubles as the button's
 * pending state (pass it as `retryConnectionPending`).
 */
export function useReconnectRefetch(onReconnected: () => void) {
  const { reconnect } = useServiceDiscovery();
  const [retryingConnection, setRetryingConnection] = useState(false);
  const handleRetryConnection = async () => {
    if (retryingConnection) return;
    setRetryingConnection(true);
    try {
      const service = await reconnect();
      if (service) onReconnected();
    } finally {
      setRetryingConnection(false);
    }
  };
  return { handleRetryConnection, retryingConnection };
}
