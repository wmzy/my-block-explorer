import { parseArgs } from 'node:util';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { createServer } from './server';

const DEFAULT_FRONTEND_URL = 'https://wmzy.github.io/my-block-explorer/';

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`, error => {
    if (error) {
      console.warn(`Could not open browser: ${error.message}`);
      console.log(`Open manually: ${url}`);
    }
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      open: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowNegative: true,
    strict: true,
  });

  if (values.help) {
    console.log(`my-block-explorer - Multi-chain blockchain explorer backend

Usage: my-block-explorer [options]

Options:
  -p, --port <number>  Server port (default: 8201, env: PORT)
  --no-open            Do not open browser after start
  -v, --version        Show version
  -h, --help           Show this help

Environment:
  PORT                 Server port (overridden by --port)
  FRONTEND_URL         URL to open in browser (default: ${DEFAULT_FRONTEND_URL})
`);
    process.exit(0);
  }

  if (values.version) {
    console.log('my-block-explorer v0.0.0-development');
    process.exit(0);
  }

  const portArg = values.port ? parseInt(values.port) : undefined;

  if (portArg !== undefined && (Number.isNaN(portArg) || portArg < 1 || portArg > 65535)) {
    console.error(`Invalid port: ${values.port}`);
    process.exit(1);
  }

  const { port: _port } = createServer({ port: portArg });

  if (values.open) {
    const url = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
    setTimeout(() => openBrowser(url), 1000);
  }
}

main();
