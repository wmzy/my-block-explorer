// Pure CLI argument parsing for the my-block-explorer bin, extracted from
// src/cli.ts so the arg surface is unit-testable without spawning the
// entry file (which boots the server graph and opens a browser).
//
// HARD CONSTRAINT (pinned in AGENTS.md): this module must NOT statically
// import anything from the server graph — ./server, ./api-app, anything
// under ./database, ./services, … — because src/cli.ts dynamic-imports
// ./server precisely so `--help`, `--version` and subcommands work in an
// empty directory without constructing the DuckDB adapter, whose
// constructor mkdirs data/ (fabricating the very thing `uninstall`
// measures). node:util is the entire import budget; anything richer
// belongs in cli.ts after the kind has been decided.
import { parseArgs } from 'node:util';
import { parseStrictInteger } from './utils/strictInteger';

export type CliArgsResult =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'uninstall'; assumeYes: boolean; force: boolean }
  | { kind: 'serve'; port: number | undefined; open: boolean }
  | { kind: 'error'; message: string; exitCode: 1 };

const USAGE_HINT = 'Run \'my-block-explorer --help\' for usage.';

/**
 * Parse the bin's argv (process.argv.slice(2)) into the action cli.ts must
 * take. Pure: no process.exit, no console, no filesystem — callers decide
 * how to print and exit, which is exactly what makes the matrix below
 * testable in-process.
 */
export function parseCliArgs(argv: string[]): CliArgsResult {
  let values: {
    port?: string;
    open?: boolean;
    yes?: boolean;
    force?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      options: {
        port: { type: 'string', short: 'p' },
        open: { type: 'boolean', default: true },
        yes: { type: 'boolean', short: 'y' },
        force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      args: argv,
      allowPositionals: true,
      // --no-open depends on this: util.parseArgs rejects --no- prefixed
      // flags as unknown options unless allowNegative is set. The failure
      // is invisible to types and unit tests that construct values by
      // hand — it only fires at runtime against real argv, so it stays
      // pinned in tests/unit/cliArgs.test.ts.
      allowNegative: true,
      strict: true,
    }));
  } catch (error) {
    // Unknown options/flags (strict mode) land here.
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }

  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  if (positionals.length > 0) {
    const [command, ...rest] = positionals;
    if (command === 'uninstall') {
      if (rest.length > 0) {
        return {
          kind: 'error',
          message: `Unexpected argument${rest.length === 1 ? '' : 's'} after 'uninstall': ${rest.join(' ')}\n${USAGE_HINT}`,
          exitCode: 1,
        };
      }
      return { kind: 'uninstall', assumeYes: values.yes === true, force: values.force === true };
    }
    return {
      kind: 'error',
      message: `Unknown command: ${command}\n${USAGE_HINT}`,
      exitCode: 1,
    };
  }

  // Strict parse: a port binds a socket, so a value the user never
  // typed is a silent misconfiguration. parseInt accepted a valid
  // prefix — '8201x' was 8201, '8e3' was 8000, and '0x2001' was
  // 8193 (hex, not decimal). The import-free leaf keeps this
  // module's no-server-graph constraint (utils/validation would
  // drag viem in for one number rule).
  const portArg =
    values.port !== undefined ? parseStrictInteger(values.port) : undefined;
  if (portArg !== undefined && (portArg === null || portArg < 1 || portArg > 65535)) {
    return {
      kind: 'error',
      message: `Invalid port: ${values.port}`,
      exitCode: 1,
    };
  }

  return { kind: 'serve', port: portArg, open: values.open !== false };
}
