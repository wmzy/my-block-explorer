// IdeService source-export containment: Standard JSON 'sources' keys are
// caller-supplied filenames that flow verbatim into the IDE export
// directory, so the write path refuses absolute paths, empty names and
// '..' segments with a named, honest error (no silent skip), while
// ordinary relative paths like 'contracts/Foo.sol' pass and land inside
// the export dir. The pure resolver is pinned directly; the write path
// runs against a real per-test tmpdir (writeSourceExport is the write
// site openInIde delegates to — exercising it here needs no IDE spawn),
// and openInIde is covered end to end on the rejection path, where it
// throws before ever spawning.
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openInIde,
  resolveContainedSourcePath,
  writeSourceExport,
  type SourceFile,
} from '@/services/IdeService';

const ADDRESS = '0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef';

// Fresh real directory per test, cleaned up afterwards.
const newDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'ide-service-test-'));

const twoFiles = (filenames: [string, string]): SourceFile[] => [
  { filename: filenames[0], content: '// a' },
  { filename: filenames[1], content: '// b' },
];

describe('resolveContainedSourcePath', () => {
  const DIR = join(tmpdir(), 'block-explorer-contracts', '1-0xdeadbeef-Test-x7k2q');

  it('resolves a normal relative path like \'contracts/Foo.sol\' inside dir', () => {
    expect(resolveContainedSourcePath(DIR, 'contracts/Foo.sol')).toBe(
      join(DIR, 'contracts', 'Foo.sol'),
    );
    expect(resolveContainedSourcePath(DIR, 'Foo.sol')).toBe(join(DIR, 'Foo.sol'));
  });

  it('rejects traversal filenames with a \'..\' segment, naming the file', () => {
    expect(() => resolveContainedSourcePath(DIR, '../../evil')).toThrow(/evil/);
    expect(() => resolveContainedSourcePath(DIR, 'contracts/../../evil.sol')).toThrow(
      /\.\.\/\.\.\/evil\.sol/,
    );
    // Even a '..' that nominally stays inside is refused, not reasoned about.
    expect(() => resolveContainedSourcePath(DIR, 'a/../b.sol')).toThrow(/\.\./);
  });

  it('rejects absolute filenames, naming the file', () => {
    expect(() => resolveContainedSourcePath(DIR, '/abs/path/evil.sol')).toThrow(
      /absolute path: \/abs\/path\/evil\.sol/,
    );
  });

  it('rejects an empty filename', () => {
    expect(() => resolveContainedSourcePath(DIR, '')).toThrow(/empty filename/);
  });
});

describe('writeSourceExport (the write site openInIde delegates to)', () => {
  it('writes normal multi-file sources inside dir, creating subdirectories', async () => {
    const dir = await newDir();
    try {
      await writeSourceExport(dir, '// single', 'Test', twoFiles(['contracts/Foo.sol', 'Bar.sol']), 'README');

      expect(await readFile(join(dir, 'contracts', 'Foo.sol'), 'utf-8')).toBe('// a');
      expect(await readFile(join(dir, 'Bar.sol'), 'utf-8')).toBe('// b');
      expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('README');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the single sanitized file when no multi-file bundle is given', async () => {
    const dir = await newDir();
    try {
      await writeSourceExport(dir, '// single', 'Test', undefined, 'README');
      await writeSourceExport(dir, '// single', 'Test', [{ filename: 'Only.sol', content: 'x' }], 'R');

      expect(await readFile(join(dir, 'Test.sol'), 'utf-8')).toBe('// single');
      expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('R');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects the whole export when one filename contains \'..\' — nothing written', async () => {
    const dir = await newDir();
    try {
      await expect(
        writeSourceExport(dir, '// single', 'Test', twoFiles(['contracts/Foo.sol', '../../evil']), 'README'),
      ).rejects.toThrow(/evil/);

      // The export is refused as a unit: no partial bundle on disk.
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an absolute filename before any write', async () => {
    const dir = await newDir();
    try {
      await expect(
        writeSourceExport(dir, '// single', 'Test', twoFiles(['/abs/path/evil.sol', 'Bar.sol']), 'README'),
      ).rejects.toThrow(/absolute path/);

      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('openInIde end to end', () => {
  it('rejects a traversal filename, naming it (throws before any IDE spawn)', async () => {
    await expect(
      openInIde('vscode', 'Test', ADDRESS, 1, '// single', twoFiles(['contracts/Foo.sol', '../../evil'])),
    ).rejects.toThrow(/\.\.\/\.\.\/evil/);
  });

  it('rejects an absolute filename, naming it', async () => {
    await expect(
      openInIde('vscode', 'Test', ADDRESS, 1, '// single', twoFiles(['/abs/path/evil.sol', 'Bar.sol'])),
    ).rejects.toThrow(/absolute path: \/abs\/path\/evil\.sol/);
  });
});
