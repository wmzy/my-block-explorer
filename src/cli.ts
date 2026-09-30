import { exec } from 'node:child_process';
import { platform } from 'node:os';
import * as readline from 'node:readline/promises';
import type { UninstallOutcome } from './uninstall';
import { appVersion } from './version';
import { parseCliArgs } from './cliArgs';

const DEFAULT_FRONTEND_URL = 'https://wmzy.github.io/my-block-explorer/';

const HELP_TEXT = `my-block-explorer - Multi-chain blockchain explorer backend

Usage: my-block-explorer [options] [command]

Commands:
  uninstall            Remove the data this explorer wrote (DuckDB files,
                       solc cache, IDE scratch dir). Shows sizes and asks
                       before deleting; --yes skips the question, --force
                       deletes even if a server is still running.

Options:
  -p, --port <number>  Server port (default: 8201, env: PORT)
  --no-open            Do not open browser after start
  -v, --version        Show version
  -h, --help           Show this help

Environment:
  PORT                 Server port (overridden by --port)
  FRONTEND_URL         URL to open in browser (default: ${DEFAULT_FRONTEND_URL})
  DATABASE_URL         Main DuckDB file (default: duckdb://data/blockchain.db)
`;

const PACKAGE_REMOVAL_GUIDANCE = `
To remove the package itself:
  - npx / pnpm dlx: nothing is persisted beyond npm's download cache
    (reclaimed automatically by npm)
  - global install: npm rm -g my-block-explorer (or pnpm rm -g)
  - from source: delete the cloned directory

Browser-side settings (watchlist, private notes, custom ABIs, theme, custom
chains) live in your browser's localStorage, not on this machine's disk —
export or inspect them from the app's Settings -> Backup & restore panel,
and remove them with the browser's own site-data controls.`;

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`, error => {
    if (error) {
      console.warn(`Could not open browser: ${error.message}`);
      console.log(`Open manually: ${url}`);
    }
  });
}

/**
 * The `uninstall` subcommand. The heavy lifting lives in src/uninstall.ts;
 * this wires the interactive pieces (readline prompt on a TTY, stdout) and
 * maps the outcome onto an exit code.
 */
async function runCliUninstall(flags: { assumeYes: boolean; force: boolean }): Promise<number> {
  // Dynamic import: the server graph constructs the DuckDB adapter, whose
  // constructor mkdirs data/ — importing it here would fabricate the data
  // being measured.
  const { runUninstall } = await import('./uninstall');

  const interactive = process.stdin.isTTY === true;
  const result = await runUninstall({
    cwd: process.cwd(),
    databaseUrl: process.env.DATABASE_URL,
    assumeYes: flags.assumeYes,
    force: flags.force,
    log: line => console.log(line),
    prompt: interactive
      ? async question => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await rl.question(question);
          return /^(y|yes)$/i.test(answer.trim());
        } finally {
          rl.close();
        }
      }
      : undefined,
  });

  console.log(PACKAGE_REMOVAL_GUIDANCE);

  const exitCodeByOutcome: Record<UninstallOutcome, number> = {
    'no-data': 0,
    'kept': 0,
    'cleaned': 0,
    'aborted-server-running': 1,
    'partial-error': 1,
  };
  return exitCodeByOutcome[result.outcome];
}

async function main(): Promise<void> {
  // Parsing lives in src/cliArgs.ts (pure, server-graph-free) so the arg
  // surface is unit-testable; this file keeps only the side effects.
  const result = parseCliArgs(process.argv.slice(2));

  if (result.kind === 'error') {
    console.error(result.message);
    process.exit(result.exitCode);
  }

  if (result.kind === 'help') {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (result.kind === 'version') {
    console.log(`my-block-explorer v${appVersion()}`);
    process.exit(0);
  }

  if (result.kind === 'uninstall') {
    const code = await runCliUninstall({
      assumeYes: result.assumeYes,
      force: result.force,
    });
    process.exit(code);
  }

  // Dynamic import for the same reason as uninstall: --help/--version/
  // subcommands must not construct the database adapter (it mkdirs data/).
  const { createServer } = await import('./server');
  const { port: _port } = await createServer({ port: result.port });

  if (result.open) {
    const url = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
    setTimeout(() => openBrowser(url), 1000);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
