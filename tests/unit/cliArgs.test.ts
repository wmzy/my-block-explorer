// Arg-surface contract for the my-block-explorer bin: src/cliArgs.ts is
// the pure half of src/cli.ts (no process.exit, no console, no server
// graph), so every branch below runs in-process. The allowNegative pin is
// the load-bearing one: --no-open only parses because of that flag, and
// the failure mode of dropping it lives in the built bundle, not types.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The no-side-effects pin runs FIRST and controls the import: the module
// must be loaded while cwd is an empty temp dir, so a regression that
// adds a static server-graph import to cliArgs.ts (the DuckDB adapter
// constructor mkdirs data/) materializes data/ right here and fails the
// assertion below instead of silently passing on an already-dirty cwd.
const emptyCwd = mkdtempSync(join(tmpdir(), 'cliargs-no-side-effects-'));
const previousCwd = process.cwd();
process.chdir(emptyCwd);
const cliArgs = await import('@/cliArgs');
process.chdir(previousCwd);
const { parseCliArgs } = cliArgs;

afterAll(() => {
  rmSync(emptyCwd, { recursive: true, force: true });
});

describe('parseCliArgs — help/version', () => {
  it('parses --help and -h', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('parses --version and -v', () => {
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseCliArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('help wins when both --help and --version are given', () => {
    expect(parseCliArgs(['--help', '--version'])).toEqual({ kind: 'help' });
  });

  it('help wins over a positional command, as cli.ts checks it first', () => {
    expect(parseCliArgs(['uninstall', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('parseCliArgs — serve shape', () => {
  it('defaults to serve with no port override and browser opening on', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'serve', port: undefined, open: true });
  });

  it('parses --port N and -p N', () => {
    expect(parseCliArgs(['--port', '3000'])).toEqual({ kind: 'serve', port: 3000, open: true });
    expect(parseCliArgs(['-p', '99'])).toEqual({ kind: 'serve', port: 99, open: true });
  });

  it('rejects non-numeric, zero, and out-of-range ports', () => {
    expect(parseCliArgs(['--port', 'abc'])).toMatchObject({
      kind: 'error',
      message: 'Invalid port: abc',
    });
    expect(parseCliArgs(['--port', '0'])).toMatchObject({
      kind: 'error',
      message: 'Invalid port: 0',
    });
    expect(parseCliArgs(['--port', '70000'])).toMatchObject({
      kind: 'error',
      message: 'Invalid port: 70000',
    });
  });

  it('parses --no-open as open:false — the allowNegative dependence', () => {
    // With allowNegative dropped, util.parseArgs rejects --no- prefixed
    // flags as unknown options ("Unknown option '--no-open'"); the result
    // here must be a serve with open:false, never an error result.
    const result = parseCliArgs(['--no-open']);
    expect(result).toEqual({ kind: 'serve', port: undefined, open: false });
  });

  it('combines --no-open with a port', () => {
    expect(parseCliArgs(['--no-open', '--port', '8201'])).toEqual({
      kind: 'serve',
      port: 8201,
      open: false,
    });
  });
});

describe('parseCliArgs — uninstall subcommand', () => {
  it('parses the bare positional', () => {
    expect(parseCliArgs(['uninstall'])).toEqual({
      kind: 'uninstall',
      assumeYes: false,
      force: false,
    });
  });

  it('parses --yes and -y as assumeYes', () => {
    expect(parseCliArgs(['uninstall', '--yes'])).toMatchObject({
      kind: 'uninstall',
      assumeYes: true,
    });
    expect(parseCliArgs(['uninstall', '-y'])).toMatchObject({ kind: 'uninstall', assumeYes: true });
  });

  it('parses --force', () => {
    expect(parseCliArgs(['uninstall', '--force'])).toMatchObject({
      kind: 'uninstall',
      force: true,
    });
  });

  it('combines --yes and --force', () => {
    expect(parseCliArgs(['uninstall', '--yes', '--force'])).toEqual({
      kind: 'uninstall',
      assumeYes: true,
      force: true,
    });
  });

  it('rejects unexpected arguments after uninstall', () => {
    const result = parseCliArgs(['uninstall', 'bogus', 'extra']);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain(
      'Unexpected arguments after \'uninstall\': bogus extra',
    );
    expect(result.kind === 'error' && result.message).toContain('--help');
  });
});

describe('parseCliArgs — junk args', () => {
  it('rejects unknown options with the parseArgs error message', () => {
    const result = parseCliArgs(['--bogus']);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain('--bogus');
  });

  it('rejects unknown commands', () => {
    const result = parseCliArgs(['frobnicate']);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain('Unknown command: frobnicate');
  });

  it('carries exit code 1 on every error', () => {
    for (const argv of [['--bogus'], ['frobnicate'], ['--port', 'abc']]) {
      const result = parseCliArgs(argv);
      expect(result).toMatchObject({ kind: 'error', exitCode: 1 });
    }
  });
});

describe('parseCliArgs — import-time side effects', () => {
  it('importing the module in an empty cwd creates no data/ directory', () => {
    // The DuckDB adapter constructor mkdirs data/ relative to cwd; the
    // whole point of the cliArgs extraction is that --help/--version stay
    // side-effect-free in an empty directory. cliArgs was first imported
    // (top of this file) with cwd = emptyCwd, so any leak lands there.
    expect(existsSync(join(emptyCwd, 'data'))).toBe(false);
    expect(existsSync(join(emptyCwd, 'data', 'blockchain.db'))).toBe(false);
  });

  it('parsing --version/--help in an empty cwd still creates nothing', () => {
    const cwdBefore = process.cwd();
    process.chdir(emptyCwd);
    try {
      expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
      expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
      expect(existsSync(join(emptyCwd, 'data'))).toBe(false);
    } finally {
      process.chdir(cwdBefore);
    }
  });
});
