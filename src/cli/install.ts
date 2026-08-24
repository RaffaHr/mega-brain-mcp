import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ProjectIdentity } from '../projects/identity.js';
import { assertRuntimeChild, runtimeLayout } from '../runtime/layout.js';
import { writeRuntimeLock, type RuntimeLockManifest } from '../runtime/lock-manifest.js';

const execFileAsync = promisify(execFile);

export const MANAGED_VERSIONS = {
  agentMemory: '0.9.29',
  codeReviewGraph: '2.3.7',
} as const;

export interface CommandRunner {
  run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void>;
}

export const systemCommandRunner: CommandRunner = {
  async run(command, args, options) {
    await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  },
};

export interface InstallRuntimeOptions {
  dataDir: string;
  identity: ProjectIdentity;
  pythonCommand?: string;
  runner?: CommandRunner;
  now?: Date;
}

export interface RuntimeInspection {
  healthy: boolean;
  manifest: RuntimeLockManifest;
  checks: Record<string, boolean>;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

export async function installManagedRuntime(options: InstallRuntimeOptions): Promise<RuntimeLockManifest> {
  const runner = options.runner ?? systemCommandRunner;
  const layout = runtimeLayout(options.dataDir, options.identity);
  const staging = assertRuntimeChild(layout, path.join(layout.runtimeRoot, `.staging-${randomUUID()}`));
  const backup = assertRuntimeChild(layout, path.join(layout.runtimeRoot, `.backup-${randomUUID()}`));
  const agentMemoryDir = path.join(staging, 'agentmemory');
  const crgDir = path.join(staging, 'code-review-graph');
  const venvDir = path.join(crgDir, 'venv');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const python = options.pythonCommand ?? (process.platform === 'win32' ? 'python.exe' : 'python3');

  await mkdir(agentMemoryDir, { recursive: true });
  await mkdir(crgDir, { recursive: true });
  let movedCurrent = false;
  try {
    await runner.run(
      npm,
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', agentMemoryDir, `@agentmemory/agentmemory@${MANAGED_VERSIONS.agentMemory}`, `@agentmemory/mcp@${MANAGED_VERSIONS.agentMemory}`],
      { cwd: staging },
    );
    await runner.run(python, ['-m', 'venv', venvDir], { cwd: staging });
    const venvPython = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
    await runner.run(venvPython, ['-m', 'pip', 'install', `code-review-graph==${MANAGED_VERSIONS.codeReviewGraph}`], { cwd: staging });

    const agentMemoryEntrypoint = path.join(agentMemoryDir, 'node_modules', '@agentmemory', 'agentmemory', 'dist', 'cli.mjs');
    const manifest: RuntimeLockManifest = {
      schemaVersion: 1,
      installedAt: (options.now ?? new Date()).toISOString(),
      project: {
        repositoryId: options.identity.repositoryId,
        checkoutId: options.identity.checkoutId,
        worktreeId: options.identity.worktreeId,
      },
      versions: { megaBrain: '0.1.0', ...MANAGED_VERSIONS },
      backends: {
        agentMemory: {
          command: process.execPath,
          args: [agentMemoryEntrypoint, '--data-dir', path.join(layout.projectRoot, 'agentmemory-data')],
          cwd: agentMemoryDir,
          lifecycle: 'daemon',
        },
        codeReviewGraph: {
          command: venvPython,
          args: ['-m', 'code_review_graph', 'serve'],
          cwd: options.identity.root,
          lifecycle: 'on-demand',
        },
      },
    };
    await writeRuntimeLock(path.join(staging, 'runtime-lock.json'), manifest);
    await writeFile(path.join(agentMemoryDir, '.installed'), MANAGED_VERSIONS.agentMemory, 'utf8');
    await writeFile(path.join(crgDir, '.installed'), MANAGED_VERSIONS.codeReviewGraph, 'utf8');

    await mkdir(layout.runtimeRoot, { recursive: true });
    if (await exists(layout.current)) {
      await rename(layout.current, backup);
      movedCurrent = true;
    }
    await rename(staging, layout.current);
    if (movedCurrent) await rm(backup, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (movedCurrent && !(await exists(layout.current)) && (await exists(backup))) {
      await rename(backup, layout.current);
    }
    throw error;
  }
}

export async function inspectManagedRuntime(dataDir: string, identity: ProjectIdentity): Promise<RuntimeInspection> {
  const layout = runtimeLayout(dataDir, identity);
  const manifest = await import('../runtime/lock-manifest.js').then(({ readRuntimeLock }) =>
    readRuntimeLock(path.join(layout.current, 'runtime-lock.json')),
  );
  const checks = {
    project: manifest.project.worktreeId === identity.worktreeId,
    agentMemory: await exists(path.join(layout.current, 'agentmemory', '.installed')),
    codeReviewGraph: await exists(path.join(layout.current, 'code-review-graph', '.installed')),
  };
  return { healthy: Object.values(checks).every(Boolean), manifest, checks };
}
