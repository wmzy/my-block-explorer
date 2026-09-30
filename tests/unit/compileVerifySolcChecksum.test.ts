// downloadAndLoad's checksum gate, fail-closed edition: an upstream list
// entry without a sha256 must be REFUSED before any download (a soljson
// runs as in-process JS once require()d, so an unverifiable blob must
// never reach the cache), a checksum mismatch still discards the
// download, and a matching checksum passes the gate (the bytes are
// cached; any later failure is the honest load/initialize step, never a
// refusal). Boundaries: fetch is stubbed globally, and the cache lands
// in a per-test tmpdir via the injectable cacheDir — no network, no
// data/ writes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CompileVerifyService,
  CompileVerifyHttpError,
  type ResolvedSolcBuild,
} from '@/services/CompileVerifyService';

const DOWNLOAD_BYTES = 'soljson-bytes';
const fetchMock = vi.fn(async () => new Response(DOWNLOAD_BYTES));
const sha256Hex = (data: string): string =>
  `0x${createHash('sha256').update(data).digest('hex')}`;

const BUILD: ResolvedSolcBuild = {
  longVersion: '0.8.99-nightly.1+commit.test',
  version: '0.8.99',
  prerelease: true,
  fileName: 'soljson-v0.8.99-nightly.1+commit.test.js',
};

let cacheDir: string;
let service: CompileVerifyService;

// downloadAndLoad is private; reached on the same instance the service
// itself routes to from loadCompiler (its real path).
const downloadAndLoad = (build: ResolvedSolcBuild): Promise<never> =>
  (
    service as unknown as {
      downloadAndLoad: (b: ResolvedSolcBuild) => Promise<never>;
    }
  ).downloadAndLoad(build);

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  cacheDir = await mkdtemp(join(tmpdir(), 'solc-cache-test-'));
  service = new CompileVerifyService({ cacheDir });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cacheDir, { recursive: true, force: true });
});

describe('downloadAndLoad checksum gate', () => {
  it('refuses a build whose list entry carries no sha256 — no download, no cache write', async () => {
    const error = await downloadAndLoad({ ...BUILD }).catch(
      (e: unknown) => e as CompileVerifyHttpError,
    );

    expect(error).toBeInstanceOf(CompileVerifyHttpError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('compiler_unavailable');
    // The refusal names the malformed upstream entry.
    expect(error.message).toContain('no sha256 checksum');
    expect(error.message).toContain(BUILD.longVersion);
    expect(error.message).toContain(BUILD.fileName);
    // Refused BEFORE the download: nothing fetched, nothing written.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it('discards the download on a checksum mismatch (unchanged behavior)', async () => {
    const error = await downloadAndLoad({ ...BUILD, sha256: `0x${'00'.repeat(32)}` }).catch(
      (e: unknown) => e as CompileVerifyHttpError,
    );

    expect(error).toBeInstanceOf(CompileVerifyHttpError);
    expect(error.message).toContain('checksum mismatch');
    expect(error.message).toContain('discarded');
    // The download happened, but the bytes were never cached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it('passes the gate on a matching checksum: bytes are cached, not refused', async () => {
    const error = await downloadAndLoad({ ...BUILD, sha256: sha256Hex(DOWNLOAD_BYTES) }).catch(
      (e: unknown) => e as CompileVerifyHttpError,
    );

    // Past the gate the verified download is cached; the failure the
    // caller then sees is the honest initialize step for the junk bytes
    // — never 'no sha256 checksum' or 'checksum mismatch'.
    expect(error).toBeInstanceOf(CompileVerifyHttpError);
    expect(error.message).not.toContain('no sha256 checksum');
    expect(error.message).not.toContain('checksum mismatch');
    expect(await readdir(cacheDir)).toContain('soljson-v0.8.99-nightly.1+commit.test.cjs');
  });
});
