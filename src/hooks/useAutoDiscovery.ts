import { useState, useEffect, useCallback, useMemo } from 'react';
import { setApiBase } from '@/util/apiBase';

const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205];
const DEFAULT_HOST = 'localhost';
const STORAGE_KEY = 'my-block-explorer-api-url';

// Probe a candidate base URL for a live backend. The old code instantiated a
// throwaway ApiClient per probe; the probes never go through the global base
// (util/http always prefixes getApiBase()), so this stays a direct fetch with
// the probe's own timeout. Same error contract as before: throws on failure,
// callers decide whether that means "port closed" or "invalid URL".
async function probeHealth(
  url: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const health = await response.json();
    if (typeof health !== 'object' || health === null) {
      throw new Error('Invalid health response');
    }
    return health as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timeout', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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
      try {
        const startTime = Date.now();
        const health = await probeHealth(url, 3000);
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

            setApiBase(service.url);

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
        const health = await probeHealth(savedUrl, 3000);

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
          setApiBase(savedUrl);
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
      const health = await probeHealth(url, 5000);

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
        setApiBase(url);

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
    setApiBase('');
  }, []);

  // Disconnect from current service (preserves saved URL for reconnect)
  const disconnect = useCallback(() => {
    setApiBase('');
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
        const health = await probeHealth(savedUrl, 3000);

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
          setApiBase(savedUrl);
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
