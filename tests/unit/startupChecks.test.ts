import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  isLoopbackHost,
  evaluateStartupSecurity,
  runStartupSecurityChecks,
  type StartupSecurityEnv,
} from '@/startupChecks';

// Pure posture logic; only the runner tests touch console/process, both
// spied so nothing leaks into the suite output or exits the worker.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('isLoopbackHost', () => {
  it('treats unset and empty hosts as loopback (local default bind)', () => {
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost('')).toBe(true);
    expect(isLoopbackHost('   ')).toBe(true);
  });

  it('recognizes the loopback spellings regardless of case and brackets', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.192.0.9')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('rejects wildcard, private and public binds as non-loopback', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });
});

describe('evaluateStartupSecurity', () => {
  const env = (overrides: Partial<StartupSecurityEnv> = {}): StartupSecurityEnv => ({
    host: '127.0.0.1',
    adminToken: 'secret',
    enableDebugApi: undefined,
    allowInsecureStart: undefined,
    ...overrides,
  });

  it('is ok on a loopback bind even with debug on and no token (local dev shape)', () => {
    const posture = evaluateStartupSecurity({
      host: undefined,
      adminToken: undefined,
      enableDebugApi: '1',
    });
    expect(posture).toMatchObject({ loopback: true, level: 'ok' });
  });

  it('warns on a public bind without ADMIN_TOKEN (ungated writes)', () => {
    const posture = evaluateStartupSecurity(env({ host: '0.0.0.0', adminToken: undefined }));
    expect(posture).toMatchObject({
      loopback: false,
      adminTokenConfigured: false,
      debugApiEnabled: false,
      level: 'warn',
    });
  });

  it('is ok on a public bind once ADMIN_TOKEN is configured (debug off)', () => {
    const posture = evaluateStartupSecurity(env({ host: '0.0.0.0' }));
    expect(posture).toMatchObject({ adminTokenConfigured: true, level: 'ok' });
  });

  it('is fatal on a public bind with the debug API enabled', () => {
    const posture = evaluateStartupSecurity(env({ host: '0.0.0.0', enableDebugApi: '1' }));
    expect(posture.level).toBe('fatal');
  });

  it('downgrades fatal to warn with ALLOW_INSECURE_START=1 (explicit risk acceptance)', () => {
    const posture = evaluateStartupSecurity(
      env({ host: '0.0.0.0', enableDebugApi: '1', allowInsecureStart: '1' }),
    );
    expect(posture).toMatchObject({ level: 'warn', debugApiEnabled: true });
  });

  it('does not treat ALLOW_INSECURE_START alone (debug off) as a warning trigger', () => {
    const posture = evaluateStartupSecurity(env({ host: '0.0.0.0', allowInsecureStart: '1' }));
    expect(posture.level).toBe('ok');
  });

  // The exhaustive posture matrix — loopback × ADMIN_TOKEN × ENABLE_DEBUG_API
  // × ALLOW_INSECURE_START, every cell. The named cases above document the
  // interesting rows; this pins the whole decision table so a future edit
  // to evaluateStartupSecurity cannot silently shift an untouched cell.
  // Derivation, exactly as the module header documents:
  // - fatal ⟺ non-loopback ∧ debug ∧ no bypass
  // - warn  ⟺ non-loopback ∧ ¬fatal ∧ (no token ∨ debug) — the bypass
  //   only converts fatal to warn; it never silences the tokenless warning
  // - ok    otherwise (every loopback bind, and fully-armed public binds)
  it.each([
    // [host, adminToken, enableDebugApi, allowInsecureStart, expected level]
    ['localhost', 'secret', '1', '1', 'ok'],
    ['localhost', 'secret', '1', undefined, 'ok'],
    ['localhost', 'secret', undefined, '1', 'ok'],
    ['localhost', 'secret', undefined, undefined, 'ok'],
    ['localhost', undefined, '1', '1', 'ok'],
    ['localhost', undefined, '1', undefined, 'ok'],
    ['localhost', undefined, undefined, '1', 'ok'],
    ['localhost', undefined, undefined, undefined, 'ok'],
    ['0.0.0.0', 'secret', '1', '1', 'warn'],
    ['0.0.0.0', 'secret', '1', undefined, 'fatal'],
    ['0.0.0.0', 'secret', undefined, '1', 'ok'],
    ['0.0.0.0', 'secret', undefined, undefined, 'ok'],
    ['0.0.0.0', undefined, '1', '1', 'warn'],
    ['0.0.0.0', undefined, '1', undefined, 'fatal'],
    ['0.0.0.0', undefined, undefined, '1', 'warn'],
    ['0.0.0.0', undefined, undefined, undefined, 'warn'],
  ] as const)(
    'host=%s token=%s debug=%s bypass=%s → %s',
    (host, adminToken, enableDebugApi, allowInsecureStart, expected) => {
      const posture = evaluateStartupSecurity(
        env({ host, adminToken, enableDebugApi, allowInsecureStart }),
      );
      expect(posture).toEqual({
        loopback: host === 'localhost',
        adminTokenConfigured: adminToken === 'secret',
        debugApiEnabled: enableDebugApi === '1',
        level: expected,
      });
    },
  );
});

describe('runStartupSecurityChecks', () => {
  it('exits before listen on a public bind with the debug API enabled', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const posture = runStartupSecurityChecks({
      HOST: '0.0.0.0',
      ENABLE_DEBUG_API: '1',
    });

    expect(posture.level).toBe('fatal');
    expect(exit).toHaveBeenCalledWith(1);
    const message = error.mock.calls.flat().join(' ');
    expect(message).toContain('refusing to start');
    expect(message).toContain('/debug/db/query');
    expect(message).toContain('ALLOW_INSECURE_START=1');
  });

  it('warns with the exposed write endpoints on a public bind without a token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const posture = runStartupSecurityChecks({ HOST: '192.168.1.10' });

    expect(posture.level).toBe('warn');
    expect(exit).not.toHaveBeenCalled();
    const message = warn.mock.calls.flat().join(' ');
    expect(message).toContain('SECURITY WARNING');
    expect(message).toContain('ADMIN_TOKEN is not configured');
    expect(message).toContain('POST   /api/rpc-configs');
    expect(message).toContain('events/ranges*');
  });

  it('stays silent on the default loopback bind', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const posture = runStartupSecurityChecks({});

    expect(posture.level).toBe('ok');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
