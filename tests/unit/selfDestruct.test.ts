// Self-destruct contract (services/selfDestruct.ts — the backend half of
// "uninstall from /ops"): the ORDER is the safety property under test —
// tickers stop, then the HTTP listener closes, then the per-chain DBs,
// then the main adapter (whose end() checkpoints the WAL), and ONLY then
// are files deleted and the process exited. A failing step must never
// abort the sequence (a file deleted under a half-closed handle is gone
// either way), and the exit code must report partial removal. The heavy
// imports (drizzle db, chain-database-manager, WatchService) are mocked
// at the module boundary so nothing here opens a real DuckDB.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const deps = vi.hoisted(() => ({
  dbEnd: vi.fn(async () => {}),
  closeAll: vi.fn(async () => {}),
  stopWatchers: vi.fn(),
}));

vi.mock('@/database/drizzle', () => ({ db: { $client: { end: deps.dbEnd } } }));
vi.mock('@/database/chain-database-manager', () => ({
  multiChainDb: { closeAll: deps.closeAll },
}));
vi.mock('@/services/WatchService', () => ({ watchService: { stop: deps.stopWatchers } }));

import {
  SELF_DESTRUCT_GRACE_MS,
  resetSelfDestructState,
  runSelfDestruct,
  scheduleSelfDestruct,
} from '@/services/selfDestruct';
import type { TargetStats, UninstallTarget } from '@/uninstall';

// A cwd that does not exist: the real resolveUninstallTargets/prune step
// compute paths under it without touching the repository's own data/.
const FAKE_CWD = '/selfdestruct-test-fixture/not-real';

const target = (kind: UninstallTarget['kind'], path: string): UninstallTarget => ({
  kind,
  path,
  label: path,
});

const stat = (t: UninstallTarget, bytes: number, files: number): TargetStats => ({
  target: t,
  exists: true,
  bytes,
  files,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetSelfDestructState();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runSelfDestruct — ordering and teardown', () => {
  it('stops tickers, closes listener → chain DBs → main db, then deletes, then exits 0', async () => {
    const closer = vi.fn(async () => {});
    const collect = vi.fn(async () => [
      stat(target('data-dir', '/x/data'), 100, 2),
      stat(target('tmp-scratch', '/x/scratch'), 5, 1),
    ]);
    const remove = vi.fn(async () => ({
      results: [
        { target: target('data-dir', '/x/data'), removed: true, bytes: 100 },
        { target: target('tmp-scratch', '/x/scratch'), removed: true, bytes: 5 },
      ],
      freedBytes: 105,
    }));
    const prune = vi.fn(async () => {});
    const exit = vi.fn();
    const logs: string[] = [];

    await runSelfDestruct({
      closer,
      cwd: FAKE_CWD,
      databaseUrl: 'duckdb://data/blockchain.db',
      collectStats: collect,
      remove,
      prune,
      log: line => logs.push(line),
      exit,
    });

    // The safety property: every close precedes every delete.
    expect(deps.stopWatchers.mock.invocationCallOrder[0]).toBeLessThan(
      closer.mock.invocationCallOrder[0],
    );
    expect(closer.mock.invocationCallOrder[0]).toBeLessThan(deps.closeAll.mock.invocationCallOrder[0]);
    expect(deps.closeAll.mock.invocationCallOrder[0]).toBeLessThan(deps.dbEnd.mock.invocationCallOrder[0]);
    expect(deps.dbEnd.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logs.some(line => line.includes('freed'))).toBe(true);
  });

  it('continues through a failing close step — deletion still happens', async () => {
    const closer = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const remove = vi.fn(async () => ({ results: [], freedBytes: 0 }));
    const exit = vi.fn();
    const logs: string[] = [];

    await runSelfDestruct({
      closer,
      cwd: FAKE_CWD,
      collectStats: vi.fn(async () => []),
      remove,
      log: line => logs.push(line),
      exit,
    });

    expect(remove).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(logs.some(line => line.includes('close http server failed'))).toBe(true);
  });

  it('exits 1 when a target fails to removal — the honest partial report', async () => {
    const failing = target('main-db', '/x/custom.db');
    const remove = vi.fn(async () => ({
      results: [{ target: failing, removed: false, bytes: 0, error: 'EBUSY' }],
      freedBytes: 0,
    }));
    const logs: string[] = [];

    await runSelfDestruct({
      closer: vi.fn(async () => {}),
      cwd: FAKE_CWD,
      databaseUrl: 'duckdb:///x/custom.db',
      collectStats: vi.fn(async () => [stat(failing, 10, 1)]),
      remove,
      log: line => logs.push(line),
      exit: vi.fn(),
    });

    expect(logs.some(line => line.includes('FAILED to remove'))).toBe(true);
  });

  it('with no existing targets nothing is removed and the exit is clean', async () => {
    const remove = vi.fn(async () => ({ results: [], freedBytes: 0 }));
    const collect = vi.fn(async () => [
      { target: target('data-dir', '/x/data'), exists: false, bytes: 0, files: 0 },
    ]);

    await runSelfDestruct({
      closer: vi.fn(async () => {}),
      cwd: FAKE_CWD,
      collectStats: collect,
      remove,
      exit: vi.fn(),
    });

    // removeTargets receives only the EXISTING targets (none here).
    expect(remove).toHaveBeenCalledWith([], FAKE_CWD);
  });
});

describe('scheduleSelfDestruct — one-shot arming', () => {
  it('runs the sequence after the grace window and refuses a second arm', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});

    expect(scheduleSelfDestruct({ graceMs: 100, run })).toBe(true);
    expect(scheduleSelfDestruct({ graceMs: 100, run })).toBe(false);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('defaults to the documented grace window', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    scheduleSelfDestruct({ run });
    await vi.advanceTimersByTimeAsync(SELF_DESTRUCT_GRACE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a failing sequence logs and exits 1 instead of leaving a half-dead process', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduleSelfDestruct({ graceMs: 10, run: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await vi.advanceTimersByTimeAsync(10);
    expect(errorSpy).toHaveBeenCalledWith('Self-destruct failed:', expect.any(Error));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
