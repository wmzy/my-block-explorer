import { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiClient, apiClient } from '@/api/client';

const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205];
const DEFAULT_HOST = 'localhost';
const STORAGE_KEY = 'my-block-explorer-api-url';

export type DiscoveryStatus =
  | 'idle' // Not started
  | 'discovering' // Scanning in progress
  | 'found' // Service found
  | 'not-found' // No service found
  | 'error'; // Discovery error

export type ServiceInfo = {
  host: string;
  port: number;
  url: string;
  version?: string;
  latency?: number;
};

export function useAutoDiscovery() {
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [currentPort, setCurrentPort] = useState<number | null>(null);

  // Derived: true when connected to a service
  const isConnected = useMemo(() => status === 'found', [status]);

  // Test a single port
  const testPort = useCallback(
    async (port: number, host = DEFAULT_HOST): Promise<ServiceInfo | null> => {
      const url = `http://${host}:${port}`;
      const testApiClient = new ApiClient(url, 3000);

      try {
        const startTime = Date.now();
        const health = await testApiClient.getHealth();
        const latency = Date.now() - startTime;

        if (health?.status) {
          return {
            host,
            port,
            url,
            version: health.version as string | undefined,
            latency,
          };
        }
      } catch (_error) {
        // Port unavailable or service not responding
      }

      return null;
    },
    [],
  );

  // Scan port range
  const discover = useCallback(
    async (ports = DEFAULT_PORTS, host = DEFAULT_HOST): Promise<ServiceInfo | null> => {
      setStatus('discovering');
      setError(null);
      setIsScanning(true);
      setServiceInfo(null);

      try {
        for (const port of ports) {
          setCurrentPort(port);

          const service = await testPort(port, host);
          if (service) {
            setServiceInfo(service);
            setStatus('found');
            setIsScanning(false);
            setCurrentPort(null);

            apiClient.setBaseUrl(service.url);

            return service;
          }
        }

        setStatus('not-found');
        setIsScanning(false);
        setCurrentPort(null);
        return null;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Discovery failed');
        setStatus('error');
        setIsScanning(false);
        setCurrentPort(null);
        return null;
      }
    },
    [testPort],
  );

  // Auto-discover on page load
  const autoDiscover = useCallback(async () => {
    const savedUrl = localStorage.getItem(STORAGE_KEY);
    if (savedUrl) {
      try {
        const testApiClient = new ApiClient(savedUrl, 3000);
        const health = await testApiClient.getHealth();

        if (health?.status) {
          const url = new URL(savedUrl);
          const serviceInfo: ServiceInfo = {
            host: url.hostname,
            port: parseInt(url.port, 10),
            url: savedUrl,
            version: health.version as string | undefined,
          };

          setServiceInfo(serviceInfo);
          setStatus('found');
          apiClient.setBaseUrl(savedUrl);
          return serviceInfo;
        }
      } catch {
        // Saved URL invalid, clear and continue scanning
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return discover();
  }, [discover]);

  // Manually set API URL
  const setApiUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      const testApiClient = new ApiClient(url, 5000);
      const health = await testApiClient.getHealth();

      if (health?.status) {
        const urlObj = new URL(url);
        const serviceInfo: ServiceInfo = {
          host: urlObj.hostname,
          port: parseInt(urlObj.port, 10) || (urlObj.protocol === 'https:' ? 443 : 80),
          url,
          version: health.version as string | undefined,
        };

        setServiceInfo(serviceInfo);
        setStatus('found');
        setError(null);

        localStorage.setItem(STORAGE_KEY, url);
        apiClient.setBaseUrl(url);

        return true;
      }

      return false;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Invalid API URL');
      return false;
    }
  }, []);

  // Reset discovery state completely
  const reset = useCallback(() => {
    setStatus('idle');
    setServiceInfo(null);
    setError(null);
    setIsScanning(false);
    setCurrentPort(null);
    localStorage.removeItem(STORAGE_KEY);
    apiClient.setBaseUrl('');
  }, []);

  // Disconnect from current service (preserves saved URL for reconnect)
  const disconnect = useCallback(() => {
    apiClient.setBaseUrl('');
    setServiceInfo(null);
    setError(null);
    setIsScanning(false);
    setCurrentPort(null);
    setStatus('not-found');
    // Intentionally keep localStorage URL for reconnect
  }, []);

  // Reconnect: try saved URL first, fallback to port scan
  const reconnect = useCallback(async (): Promise<ServiceInfo | null> => {
    const savedUrl = localStorage.getItem(STORAGE_KEY);

    if (savedUrl) {
      setStatus('discovering');
      setIsScanning(true);
      setError(null);

      try {
        const testApiClient = new ApiClient(savedUrl, 3000);
        const health = await testApiClient.getHealth();

        if (health?.status) {
          const url = new URL(savedUrl);
          const info: ServiceInfo = {
            host: url.hostname,
            port: parseInt(url.port, 10),
            url: savedUrl,
            version: health.version as string | undefined,
          };

          setServiceInfo(info);
          setStatus('found');
          setIsScanning(false);
          apiClient.setBaseUrl(savedUrl);
          return info;
        }
      } catch {
        // Saved URL no longer valid, fall through to full scan
      }
    }

    // Fallback to port scanning
    return discover();
  }, [discover]);

  // Auto-discover on mount
  useEffect(() => {
    autoDiscover();
  }, [autoDiscover]);

  return {
    status,
    serviceInfo,
    error,
    isScanning,
    currentPort,
    isConnected,
    discover,
    autoDiscover,
    setApiUrl,
    reset,
    disconnect,
    reconnect,
    testPort,
  };
}
