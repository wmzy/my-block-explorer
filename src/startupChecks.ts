// Startup security posture for the standalone API server (src/server.ts).
//
// Zero-dependency and side-effect-free on import, mirroring the
// cors-origins.ts precedent: the vite dev bridge dynamically imports
// src/api-app.ts, so nothing in that graph may decide to exit the process
// at module-load time. server.ts calls runStartupSecurityChecks()
// explicitly, right before listen().
//
// Policy (public-deployment safety):
// - HOST unset is the local default bind and is treated as loopback.
// - Non-loopback bind + no ADMIN_TOKEN: warn loudly — every endpoint gated
//   by requireAdminTokenIfConfigured runs wide open to the network.
// - Non-loopback bind + ENABLE_DEBUG_API=1: refuse to start (raw SQL
//   execution on a reachable interface), unless ALLOW_INSECURE_START=1
//   explicitly accepts the risk — in which case the warning still fires.

export type StartupSecurityEnv = {
  host?: string | undefined;
  adminToken?: string | undefined;
  enableDebugApi?: string | undefined;
  allowInsecureStart?: string | undefined;
};

export type StartupSecurityLevel = 'ok' | 'warn' | 'fatal';

export type StartupSecurityPosture = {
  loopback: boolean;
  adminTokenConfigured: boolean;
  debugApiEnabled: boolean;
  level: StartupSecurityLevel;
};

// Mutating endpoints that requireAdminTokenIfConfigured leaves ungated when
// ADMIN_TOKEN is unset (the performance subtree is fail-closed and RPC
// proxy reads like /contracts/:address/read carry no local state).
const UNGATED_WRITE_ENDPOINTS = [
  'POST   /api/rpc-configs',
  'DELETE /api/rpc-configs/:chainId',
  'POST|PATCH|DELETE /api/chains/:chainId/contracts/:address/events/ranges*',
  'POST   /api/chains/:chainId/contracts/:address/clear-cache',
  'POST   /api/chains/:chainId/contracts/:address/open-in-ide',
  'DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache',
] as const;

export function isLoopbackHost(host: string | undefined): boolean {
  // Unset/empty host = default bind; treated as loopback per policy above.
  const value = (host ?? '').trim().toLowerCase();
  if (!value) return true;
  // Tolerate bracketed IPv6 forms ("[::1]") and the expanded ::1 spelling.
  const unbracketed = value.replace(/^\[/, '').replace(/\]$/, '');
  if (unbracketed === 'localhost' || unbracketed === '::1') return true;
  if (unbracketed === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed);
}

export function evaluateStartupSecurity(env: StartupSecurityEnv): StartupSecurityPosture {
  const loopback = isLoopbackHost(env.host);
  const adminTokenConfigured = Boolean(env.adminToken);
  const debugApiEnabled = env.enableDebugApi === '1';

  if (!loopback && debugApiEnabled && env.allowInsecureStart !== '1') {
    return { loopback, adminTokenConfigured, debugApiEnabled, level: 'fatal' };
  }
  // Warn whenever the bind is public and something security-relevant is
  // missing: no token at all, or the debug API exposed via the explicit
  // ALLOW_INSECURE_START escape hatch.
  if (!loopback && (!adminTokenConfigured || debugApiEnabled)) {
    return { loopback, adminTokenConfigured, debugApiEnabled, level: 'warn' };
  }
  return { loopback, adminTokenConfigured, debugApiEnabled, level: 'ok' };
}

function banner(line: string): string {
  const rule = '='.repeat(72);
  return `${rule}\n ${line}\n${rule}`;
}

function insecureWarning(host: string | undefined, posture: StartupSecurityPosture): string {
  const lines = [
    banner(`SECURITY WARNING: binding to non-loopback host "${host ?? ''}"`),
  ];
  if (!posture.adminTokenConfigured) {
    lines.push(
      ' ADMIN_TOKEN is not configured — these mutating endpoints are UNGATED:',
      ...UNGATED_WRITE_ENDPOINTS.map(endpoint => `   - ${endpoint}`),
      ' Anyone who can reach this host can rewrite RPC config and indexing state.',
      ' Set ADMIN_TOKEN to gate them (requests then need the x-admin-token header).',
    );
  }
  if (posture.debugApiEnabled) {
    lines.push(
      ' ENABLE_DEBUG_API=1 is active: arbitrary SQL execution is exposed at',
      '   POST /debug/db/query (allowed only because ALLOW_INSECURE_START=1).',
    );
  }
  lines.push(banner(''));
  return lines.join('\n');
}

function fatalMessage(host: string | undefined): string {
  const rule = '='.repeat(72);
  return [
    rule,
    ` FATAL: refusing to start — ENABLE_DEBUG_API=1 with a non-loopback bind ("${host ?? ''}")`,
    rule,
    ' The debug API exposes arbitrary SQL execution (POST /debug/db/query)',
    ' and must not run on a network-reachable interface. Fix one of:',
    '   - unset ENABLE_DEBUG_API, or',
    '   - set HOST to a loopback address (localhost / 127.0.0.1 / ::1), or',
    '   - explicitly accept the risk with ALLOW_INSECURE_START=1.',
    rule,
  ].join('\n');
}

// Reads the process environment (overridable for tests) and acts on the
// evaluated posture: fatal exits before listen, warn prints the multi-line
// warning. Returns the posture so callers (and tests) can assert it.
export function runStartupSecurityChecks(
  env: NodeJS.ProcessEnv = process.env,
): StartupSecurityPosture {
  const posture = evaluateStartupSecurity({
    host: env.HOST,
    adminToken: env.ADMIN_TOKEN,
    enableDebugApi: env.ENABLE_DEBUG_API,
    allowInsecureStart: env.ALLOW_INSECURE_START,
  });

  if (posture.level === 'fatal') {
    console.error(fatalMessage(env.HOST));
    process.exit(1);
  }

  if (posture.level === 'warn') {
    console.warn(insecureWarning(env.HOST, posture));
  }

  return posture;
}
