import { execSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../server/logger';

const logger = createLogger('ide-service');

export type IdeId = 'vscode' | 'cursor' | 'zed' | 'webstorm' | 'sublime';

type IdeConfig = {
  command: string;
  displayName: string;
};

const IDE_REGISTRY: Record<IdeId, IdeConfig> = {
  vscode: { command: 'code', displayName: 'VS Code' },
  cursor: { command: 'cursor', displayName: 'Cursor' },
  zed: { command: 'zed', displayName: 'Zed' },
  webstorm: { command: 'webstorm', displayName: 'WebStorm' },
  sublime: { command: 'subl', displayName: 'Sublime Text' },
};

export type SourceFile = {
  filename: string;
  content: string;
};

// Resolves a caller-supplied source filename to a path inside dir.
// Standard JSON 'sources' keys flow here verbatim (CompileVerifyService
// persists them as-is), so a hostile key — an absolute path or anything
// with a '..' segment — must never reach writeFile: it is refused with
// an error naming the file (honest failure, no silent skip). Ordinary
// relative paths with subdirectories ('contracts/Foo.sol') pass.
export function resolveContainedSourcePath(dir: string, filename: string): string {
  if (filename === '') {
    throw new Error('Refusing to write a source file with an empty filename');
  }
  if (isAbsolute(filename)) {
    throw new Error(`Refusing to write source file with an absolute path: ${filename}`);
  }
  if (filename.split(/[\\/]/).includes('..')) {
    throw new Error(`Refusing to write source file with a '..' segment: ${filename}`);
  }
  // Backstop: whatever the shape, the resolved target must stay inside dir.
  const target = resolve(dir, filename);
  if (!target.startsWith(dir + sep)) {
    throw new Error(`Refusing to write source file outside the export directory: ${filename}`);
  }
  return target;
}

// Writes the export bundle — source files (containment-guarded above)
// plus the README — into dir. Split out of openInIde so the write path
// is unit-testable without spawning a real IDE process.
export async function writeSourceExport(
  dir: string,
  sourceCode: string,
  sanitizedName: string,
  sourceFiles: SourceFile[] | undefined,
  readme: string,
): Promise<void> {
  if (sourceFiles && sourceFiles.length > 1) {
    // Resolve every filename first: a hostile key aborts the export
    // before anything is written, so a refused bundle is never partial.
    const paths = sourceFiles.map(file => resolveContainedSourcePath(dir, file.filename));
    for (const [index, file] of sourceFiles.entries()) {
      const filePath = paths[index];
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }
  } else {
    const fileName = `${sanitizedName}.sol`;
    await writeFile(join(dir, fileName), sourceCode, 'utf-8');
  }
  await writeFile(join(dir, 'README.md'), readme, 'utf-8');
}

function isCommandAvailable(cmd: string): boolean {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${checkCmd} ${cmd}`, { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function detectInstalledIdes(): IdeId[] {
  return (Object.keys(IDE_REGISTRY) as IdeId[]).filter(id =>
    isCommandAvailable(IDE_REGISTRY[id].command),
  );
}

export function getDetectedIdesInfo() {
  const installed = detectInstalledIdes();
  return installed.map(id => ({
    id,
    displayName: IDE_REGISTRY[id].displayName,
    command: IDE_REGISTRY[id].command,
  }));
}

export async function openInIde(
  ide: IdeId,
  contractName: string,
  address: string,
  chainId: number,
  sourceCode: string,
  sourceFiles: SourceFile[] | undefined,
  compilerVersion?: string,
  optimizationEnabled?: boolean,
  optimizationRuns?: number,
): Promise<{ directory: string }> {
  const ideConfig = IDE_REGISTRY[ide];
  if (!ideConfig) {
    throw new Error(`Unsupported IDE: ${ide}`);
  }

  const sanitizedName = (contractName ?? `contract-${address.slice(0, 8)}`).replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
  const sanitizedAddress = address.toLowerCase();

  const baseDir = join(tmpdir(), 'block-explorer-contracts');
  await mkdir(baseDir, { recursive: true });
  const prefix = join(baseDir, `${chainId}-${sanitizedAddress.slice(0, 10)}-${sanitizedName}-`);
  const dir = await mkdtemp(prefix);

  const readmeContent = generateReadme({
    chainId,
    address,
    contractName: sanitizedName,
    compilerVersion,
    optimizationEnabled,
    optimizationRuns,
    sourceFileCount: sourceFiles?.length ?? 1,
    openedAt: new Date().toISOString(),
  });
  await writeSourceExport(dir, sourceCode, sanitizedName, sourceFiles, readmeContent);

  const child = spawn(ideConfig.command, [dir], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  logger.info({ ide, directory: dir, chainId, address }, 'Opened contract source in IDE');
  return { directory: dir };
}

function generateReadme(meta: {
  chainId: number;
  address: string;
  contractName: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceFileCount: number;
  openedAt: string;
}): string {
  const lines = [
    `# ${meta.contractName}`,
    '',
    `**Chain ID:** ${meta.chainId}`,
    `**Address:** \`${meta.address}\``,
    '',
  ];

  if (meta.compilerVersion) {
    lines.push(`**Compiler:** ${meta.compilerVersion}`);
  }
  if (meta.optimizationEnabled !== undefined) {
    lines.push(
      `**Optimization:** ${meta.optimizationEnabled ? `Enabled (${meta.optimizationRuns ?? 200} runs)` : 'Disabled'}`,
    );
  }
  lines.push(`**Source Files:** ${meta.sourceFileCount}`);
  lines.push(`**Opened:** ${meta.openedAt}`);
  lines.push('');
  lines.push(
    '> This directory was generated by Block Explorer. Source files are read-only copies.',
  );
  lines.push('');

  return lines.join('\n');
}
