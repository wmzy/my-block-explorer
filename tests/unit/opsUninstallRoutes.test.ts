// Uninstall route contract (the /ops danger zone): preview enumerates
// exactly what the shared src/uninstall.ts enumeration resolves (with
// sizes and an exists flag — reads only), execute demands the verbatim
// confirmation phrase, arms the self-destruct EXACTLY once (409 inside
// the grace window) and answers 202 with the grace window. Both sit
// behind the sub-app's OPT-IN admin gate (open zero-config, 403 with a
// configured ADMIN_TOKEN and a missing/wrong header) and share the
// 4/min·burst-3 bucket. The self-destruct and the fs-touching uninstall
// helpers are faked at the module boundary — nothing here deletes files
// or exits the process.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { getRateLimitStats, resetRateLimiterState } from '@/middleware/rate-limit';

const uninstall = vi.hoisted(() => {
  const dataDir = { kind: 'data-dir' as const, path: '/srv/explorer/data', label: 'data' };
  const scratch = {
    kind: 'tmp-scratch' as const,
    path: '/tmp/block-explorer-contracts',
    label: '/tmp/block-explorer-contracts',
  };
  return {
    dataDir,
    scratch,
    resolveUninstallTargets: vi.fn(() => [dataDir, scratch]),
    collectTargetStats: vi.fn(async () => [
      { target: dataDir, exists: true, bytes: 21_840_000, files: 3 },
      { target: scratch, exists: false, bytes: 0, files: 0 },
    ]),
    scheduleSelfDestruct: vi.fn(() => true),
  };
});

vi.mock('@/uninstall', () => ({
  resolveUninstallTargets: uninstall.resolveUninstallTargets,
  collectTargetStats: uninstall.collectTargetStats,
}));

vi.mock('@/services/selfDestruct', () => ({
  scheduleSelfDestruct: uninstall.scheduleSelfDestruct,
  SELF_DESTRUCT_GRACE_MS: 1500,
  UNINSTALL_CONFIRM_PHRASE: 'uninstall',
}));

// The summary half of the sub-app is not under test here, but the module
// imports its collectors — stub them so mounting stays side-effect free.
vi.mock('@/services/OpsService', () => ({
  collectStorageSummary: vi.fn(),
  collectIndexingSummary: vi.fn(),
  collectWatchSummary: vi.fn(),
  collectDeepScanSummary: vi.fn(),
  collectMetaSummary: vi.fn(),
}));

import opsRoutes from '@/routes/ops';

const app = new Hono();
app.route('/api', opsRoutes);

const postJson = (path: string, body?: unknown, token?: string) =>
  app.request(`/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { 'x-admin-token': token } : {}),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const postPreview = (token?: string) => postJson('/ops/uninstall/preview', {}, token);
const postExecute = (body: unknown, token?: string) => postJson('/ops/uninstall', body, token);

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  uninstall.resolveUninstallTargets.mockReturnValue([uninstall.dataDir, uninstall.scratch]);
  uninstall.collectTargetStats.mockResolvedValue([
    { target: uninstall.dataDir, exists: true, bytes: 21_840_000, files: 3 },
    { target: uninstall.scratch, exists: false, bytes: 0, files: 0 },
  ]);
  uninstall.scheduleSelfDestruct.mockReturnValue(true);
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('OPT-IN gate — shared with the summary', () => {
  it('is open in a zero-config local session', async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await postPreview()).status).toBe(200);
  });

  it('rejects both endpoints with 403 once ADMIN_TOKEN is set without the header', async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    expect((await postPreview()).status).toBe(403);
    expect((await postExecute({ confirm: 'uninstall' })).status).toBe(403);
    expect(uninstall.scheduleSelfDestruct).not.toHaveBeenCalled();
  });

  it('accepts the matching token', async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    expect((await postExecute({ confirm: 'uninstall' }, 'test-token')).status).toBe(202);
  });
});

describe('POST /api/ops/uninstall/preview — enumeration only', () => {
  it('returns the shared enumeration with sizes and the confirm phrase', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await postPreview();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      targets: [
        {
          kind: 'data-dir',
          path: '/srv/explorer/data',
          label: 'data',
          exists: true,
          bytes: 21_840_000,
          files: 3,
        },
        {
          kind: 'tmp-scratch',
          path: '/tmp/block-explorer-contracts',
          label: '/tmp/block-explorer-contracts',
          exists: false,
          bytes: 0,
          files: 0,
        },
      ],
      existingBytes: 21_840_000,
      existingFiles: 3,
      confirmPhrase: 'uninstall',
    });
    expect(uninstall.resolveUninstallTargets).toHaveBeenCalledWith({ cwd: process.cwd() });
    expect(uninstall.collectTargetStats).toHaveBeenCalledWith([uninstall.dataDir, uninstall.scratch]);
    expect(uninstall.scheduleSelfDestruct).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/uninstall — the self-destruct arm', () => {
  it('rejects a non-JSON body with 400 invalid_json', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await postExecute('this is not json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
    expect(uninstall.scheduleSelfDestruct).not.toHaveBeenCalled();
  });

  it('rejects any confirmation other than the verbatim phrase', async () => {
    delete process.env.ADMIN_TOKEN;
    // Three probes: the shared 4/min·burst-3 bucket admits exactly three
    // in-window requests — more would trip the limiter, not the gate.
    for (const wrong of [undefined, true, 'Uninstall']) {
      const res = await postExecute(wrong === undefined ? {} : { confirm: wrong });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('confirmation_mismatch');
    }
    expect(uninstall.scheduleSelfDestruct).not.toHaveBeenCalled();
  });

  it('arms once and answers 202 with the grace window', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await postExecute({ confirm: 'uninstall' });
    expect(res.status).toBe(202);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'scheduled', graceMs: 1500 });
    expect(uninstall.scheduleSelfDestruct).toHaveBeenCalledTimes(1);
  });

  it('answers 409 already_scheduled inside the grace window', async () => {
    delete process.env.ADMIN_TOKEN;
    uninstall.scheduleSelfDestruct.mockReturnValue(false);
    const res = await postExecute({ confirm: 'uninstall' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_scheduled');
  });
});

describe('rate limiting — 4/min, burst 3 (shared by both endpoints)', () => {
  it('allows the burst then answers 429 with Retry-After', async () => {
    delete process.env.ADMIN_TOKEN;
    const responses = await Promise.all(Array.from({ length: 4 }, () => postPreview()));
    expect(responses.slice(0, 3).map(r => r.status)).toEqual([200, 200, 200]);
    expect(responses[3].status).toBe(429);
    expect(responses[3].headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('counts hits and rejections in the stats snapshot', async () => {
    delete process.env.ADMIN_TOKEN;
    await Promise.all(Array.from({ length: 4 }, () => postPreview()));
    const own = getRateLimitStats().find(bucket => bucket.name === 'ops-uninstall');
    expect(own).toMatchObject({ capacity: 3, requestsPerMinute: 4, hits: 4, rejected: 1 });
  });
});
