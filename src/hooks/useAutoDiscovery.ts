import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  setApiBase,
  getStoredManualBase,
  storeManualBase,
  clearStoredManualBase,
} from '@/util/apiBase';

export const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205] as const;
const DEFAULT_HOST = 'localhost';
// Per-probe budget for the port scan. All candidates are probed in
// parallel, so this is also the whole-scan worst case (~1.5s instead of
// the old serial ports × 3s ≈ 15s).
const PROBE_TIMEOUT_MS = 1500;
// The saved manual base is an explicit user choice, not a guess: give it
// more patience than a scan probe before declaring it dead.
const SAVED_URL_TIMEOUT_MS = 3000;
const MANUAL_URL_TIMEOUT_MS = 5000;

// Probe a candidate base URL for a live backend. The probes never go
// through the global base (util/http always prefixes getApiBase()), so this
// stays a direct fetch with the probe's own timeout. Same error contract
// as before: throws on failure, callers decide whether that means "port
// closed" or "invalid URL".
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

// Probe one port. Never rejects: an unreachable port maps to null so the
// parallel scan can use Promise.all directly.
async function probePort(
  port: number,
  host = DEFAULT_HOST,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ServiceInfo | null> {
  const url = `http://${host}:${port}`;
  try {
    const startTime = Date.now();
    const health = await probeHealth(url, timeoutMs);
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
  } catch {
    // Port unavailable or service not responding
  }

  return null;
}

function serviceInfoFromUrl(
  url: string,
  health: Record<string, unknown>,
): ServiceInfo {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80),
    url,
    version: health.version as string | undefined,
  };
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

  // Derived: true when connected to a service
  const isConnected = useMemo(() => status === 'found', [status]);

  // Scan port range. Every candidate is probed concurrently: the worst
  // case is one probe timeout instead of ports × timeout, and probePort
  // never rejects, so Promise.all is allSettled-equivalent while keeping
  // the port order — the first (lowest) healthy port wins, matching the
  // old serial scan's preference.
  const discover = useCallback(
    async (
      ports: readonly number[] = DEFAULT_PORTS,
      host = DEFAULT_HOST,
    ): Promise<ServiceInfo | null> => {
      setStatus('discovering');
      setError(null);
      setIsScanning(true);
      setServiceInfo(null);

      try {
        const services = await Promise.all(
          ports.map(port => probePort(port, host)),
        );
        const service = services.find(candidate => candidate !== null) ?? null;

        if (service) {
          setServiceInfo(service);
          setStatus('found');
          setApiBase(service.url);
          return service;
        }

        setStatus('not-found');
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Discovery failed');
        setStatus('error');
        return null;
      } finally {
        setIsScanning(false);
      }
    },
    [],
  );

  // Auto-discover on page load. The stored manual base is an explicit
  // choice, so it is probed first and wins while alive (see apiBase.ts
  // precedence contract); only a dead one falls through to the scan.
  const autoDiscover = useCallback(async (): Promise<ServiceInfo | null> => {
    const savedUrl = getStoredManualBase();
    if (savedUrl) {
      try {
        const health = await probeHealth(savedUrl, SAVED_URL_TIMEOUT_MS);

        if (health?.status) {
          const info = serviceInfoFromUrl(savedUrl, health);
          setServiceInfo(info);
          setStatus('found');
          setApiBase(savedUrl);
          return info;
        }
      } catch {
        // Saved URL invalid, clear and continue scanning
        clearStoredManualBase();
      }
    }

    return discover();
  }, [discover]);

  // Manually set API URL (setup panel). Persists the choice so it takes
  // precedence over scans on the next startup too.
  const setApiUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      const health = await probeHealth(url, MANUAL_URL_TIMEOUT_MS);

      if (health?.status) {
        setServiceInfo(serviceInfoFromUrl(url, health));
        setStatus('found');
        setError(null);

        storeManualBase(url);
        setApiBase(url);

        return true;
      }

      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid API URL');
      return false;
    }
  }, []);

  // Disconnect from current service (preserves saved URL for reconnect)
  const disconnect = useCallback(() => {
    setApiBase('');
    setServiceInfo(null);
    setError(null);
    setIsScanning(false);
    setStatus('not-found');
    // Intentionally keep the stored manual base for reconnect
  }, []);

  // Reconnect: try saved URL first, fallback to port scan
  const reconnect = useCallback(async (): Promise<ServiceInfo | null> => {
    const savedUrl = getStoredManualBase();

    if (savedUrl) {
      setStatus('discovering');
      setIsScanning(true);
      setError(null);

      try {
        const health = await probeHealth(savedUrl, SAVED_URL_TIMEOUT_MS);

        if (health?.status) {
          const info = serviceInfoFromUrl(savedUrl, health);
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
    isConnected,
    discover,
    autoDiscover,
    setApiUrl,
    disconnect,
    reconnect,
  };
}
