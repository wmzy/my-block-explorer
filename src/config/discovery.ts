// Ports the backend auto-discovery scans: hooks/useAutoDiscovery.ts
// (browser) probes them for a live backend, and the uninstall CLI
// (src/uninstall.ts) treats an answer on any of them as "a server holds
// the DuckDB files open" and refuses deletion. Import-free leaf by
// contract — the CLI process that consumes it must never touch the
// server graph, so this file must gain no imports.
export const DEFAULT_PROBE_PORTS = [8201, 8202, 8203, 8204, 8205] as const;
