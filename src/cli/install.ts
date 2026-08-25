import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ProjectIdentity } from '../projects/identity.js';
import { assertRuntimeChild, runtimeLayout } from '../runtime/layout.js';
import { createRuntimeIsolation, writeRuntimeLock, type RuntimeLockManifest } from '../runtime/lock-manifest.js';
import { III_ENGINE_VERSION, installIiiEngineArtifact } from '../runtime/iii-engine.js';
import type { AgentMemoryMode } from '../runtime/types.js';
import { npmInvocation, runInstallPreflight, type InstallPreflightOptions } from './preflight.js';

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
  agentMemoryMode?: AgentMemoryMode;
  pythonCommand?: string;
  runner?: CommandRunner;
  now?: Date;
  preflight?: false | InstallPreflightOptions;
  validateArtifacts?: boolean;
  remoteAgentMemory?: { baseUrl: string; secretEnvVar: string };
  remoteIsolationProbe?: () => Promise<unknown>;
  platform?: NodeJS.Platform;
  iiiEngine?: {
    confirmed: boolean;
    expectedSha256: string;
    download(): Promise<Uint8Array>;
  };
  codeReviewGraph?:
    | { mode: 'managed' }
    | { mode: 'custom'; command: string; args?: string[] };
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
  const agentMemoryMode = options.agentMemoryMode ?? 'managed';
  if (agentMemoryMode === 'remote') {
    if (!options.remoteAgentMemory) {
      throw new Error('Remote AgentMemory requires a URL and the name of the environment variable containing its secret. No files were changed.');
    }
    try { new URL(options.remoteAgentMemory.baseUrl); }
    catch { throw new Error('Remote AgentMemory URL is invalid. No files were changed.'); }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.remoteAgentMemory.secretEnvVar)) {
      throw new Error('Remote AgentMemory secret environment variable name is invalid. No files were changed.');
    }
    if (!options.remoteIsolationProbe) {
      throw new Error('Remote AgentMemory requires a reversible namespace isolation probe. No files were changed.');
    }
    await options.remoteIsolationProbe();
  }
  const runner = options.runner ?? systemCommandRunner;
  const preflight = options.preflight === false
    ? null
    : await runInstallPreflight({ ...options.preflight, ...(options.pythonCommand ? { pythonCommand: options.pythonCommand } : {}) });
  const layout = runtimeLayout(options.dataDir, options.identity);
  const isolation = createRuntimeIsolation(layout, options.identity.worktreeId);
  const platform = options.platform ?? preflight?.platform ?? (options.preflight === false ? undefined : process.platform);
  if (agentMemoryMode === 'managed' && platform === 'win32' && !options.iiiEngine) {
    throw new Error('Managed AgentMemory on Windows requires a confirmed, checksummed iii-engine artifact. No files were changed.');
  }
  const installIiiEngine = agentMemoryMode === 'managed' && platform === 'win32' && options.iiiEngine;
  if (installIiiEngine && !installIiiEngine.confirmed) {
    throw new Error('iii-engine installation requires explicit user confirmation. No files were changed.');
  }
  if (installIiiEngine && !/^[a-f0-9]{64}$/u.test(installIiiEngine.expectedSha256)) {
    throw new Error('iii-engine checksum is invalid. No files were changed.');
  }
  const staging = assertRuntimeChild(layout, path.join(layout.runtimeRoot, `.staging-${randomUUID()}`));
  const backup = assertRuntimeChild(layout, path.join(layout.runtimeRoot, `.backup-${randomUUID()}`));
  const agentMemoryDir = path.join(staging, 'agentmemory');
  const crgDir = path.join(staging, 'code-review-graph');
  const venvDir = path.join(crgDir, 'venv');
  const npm = npmInvocation();
  const python = options.pythonCommand ?? preflight?.pythonCommand ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const codeReviewGraph = options.codeReviewGraph ?? { mode: 'managed' as const };

  if (agentMemoryMode === 'managed') await mkdir(agentMemoryDir, { recursive: true });
  await mkdir(crgDir, { recursive: true });
  let movedCurrent = false;
  try {
    if (installIiiEngine) {
      await installIiiEngineArtifact({
        destination: path.join(isolation.paths.iiiEngine, 'iii.exe'),
        version: III_ENGINE_VERSION,
        ...installIiiEngine,
      });
    }
    if (agentMemoryMode === 'managed') {
      await runner.run(
        npm.command,
        [...npm.args, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', agentMemoryDir, `@agentmemory/agentmemory@${MANAGED_VERSIONS.agentMemory}`, `@agentmemory/mcp@${MANAGED_VERSIONS.agentMemory}`],
        { cwd: staging },
      );
    }
    await mkdir(isolation.paths.codeReviewGraph, { recursive: true });
    if (codeReviewGraph.mode === 'managed') {
      await runner.run(python, ['-m', 'venv', venvDir], { cwd: staging });
    }
    const venvPython = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
    if (codeReviewGraph.mode === 'managed') {
      await runner.run(venvPython, ['-m', 'pip', 'install', `code-review-graph==${MANAGED_VERSIONS.codeReviewGraph}`], { cwd: staging });
    }

    const finalAgentMemoryDir = path.join(layout.current, 'agentmemory');
    const finalCrgDir = path.join(layout.current, 'code-review-graph');
    const finalVenvPython = process.platform === 'win32'
      ? path.join(finalCrgDir, 'venv', 'Scripts', 'python.exe')
      : path.join(finalCrgDir, 'venv', 'bin', 'python');
    const stagedAgentMemoryEntrypoint = path.join(agentMemoryDir, 'node_modules', '@agentmemory', 'agentmemory', 'dist', 'cli.mjs');
    const finalAgentMemoryEntrypoint = path.join(finalAgentMemoryDir, 'node_modules', '@agentmemory', 'agentmemory', 'dist', 'cli.mjs');
    if (options.validateArtifacts ?? runner === systemCommandRunner) {
      if (agentMemoryMode === 'managed' && !(await exists(stagedAgentMemoryEntrypoint))) {
        throw new Error('AgentMemory installation completed without an executable CLI entrypoint');
      }
      if (codeReviewGraph.mode === 'managed' && !(await exists(venvPython))) {
        throw new Error('Code Review Graph installation completed without a virtualenv Python executable');
      }
      if (codeReviewGraph.mode === 'managed') {
        await runner.run(venvPython, ['-c', 'import code_review_graph'], { cwd: staging });
      }
    }
    const crgEnvironment = {
      ...process.env,
      CRG_DATA_DIR: isolation.paths.codeReviewGraph,
      CRG_REPO_ROOT: path.resolve(options.identity.root),
    };
    const crgCommand = codeReviewGraph.mode === 'managed' ? venvPython : codeReviewGraph.command;
    const crgBaseArgs = codeReviewGraph.mode === 'managed' ? ['-m', 'code_review_graph'] : codeReviewGraph.args ?? [];
    await runner.run(crgCommand, [...crgBaseArgs, 'build'], {
      cwd: options.identity.root,
      env: crgEnvironment,
    });
    if ((options.validateArtifacts ?? runner === systemCommandRunner)
      && (await readdir(isolation.paths.codeReviewGraph)).length === 0) {
      throw new Error(`Code Review Graph did not persist artifacts in ${isolation.paths.codeReviewGraph}`);
    }

    const manifest: RuntimeLockManifest = {
      schemaVersion: 1,
      installedAt: (options.now ?? new Date()).toISOString(),
      agentMemoryMode,
      ...(agentMemoryMode === 'remote' ? { remoteAgentMemory: options.remoteAgentMemory! } : {}),
      project: {
        repositoryId: options.identity.repositoryId,
        checkoutId: options.identity.checkoutId,
        worktreeId: options.identity.worktreeId,
      },
      versions: {
        megaBrain: '0.1.0',
        ...MANAGED_VERSIONS,
        ...(installIiiEngine ? { iiiEngine: III_ENGINE_VERSION } : {}),
      },
      backends: {
        ...(agentMemoryMode === 'managed' ? {
          agentMemory: {
            command: process.execPath,
            args: [finalAgentMemoryEntrypoint, '--data-dir', isolation.paths.agentMemory, '--port', String(isolation.ports.rest)],
            cwd: finalAgentMemoryDir,
            lifecycle: 'daemon' as const,
            ...(installIiiEngine ? { prependPath: isolation.paths.iiiEngine } : {}),
          },
        } : {}),
        codeReviewGraph: {
          command: codeReviewGraph.mode === 'managed' ? finalVenvPython : codeReviewGraph.command,
          args: codeReviewGraph.mode === 'managed'
            ? ['-m', 'code_review_graph', 'serve']
            : [...(codeReviewGraph.args ?? []), 'serve'],
          cwd: options.identity.root,
          lifecycle: 'on-demand',
          environment: {
            CRG_DATA_DIR: isolation.paths.codeReviewGraph,
            CRG_REPO_ROOT: path.resolve(options.identity.root),
          },
        },
      },
      isolation,
    };
    await writeRuntimeLock(path.join(staging, 'runtime-lock.json'), manifest);
    if (agentMemoryMode === 'managed') {
      await writeFile(path.join(agentMemoryDir, '.installed'), MANAGED_VERSIONS.agentMemory, 'utf8');
    }
    await writeFile(path.join(crgDir, '.installed'), codeReviewGraph.mode === 'managed' ? MANAGED_VERSIONS.codeReviewGraph : 'custom', 'utf8');

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
    isolation: manifest.isolation?.worktreeId === identity.worktreeId
      && Object.values(manifest.isolation.paths).every(path.isAbsolute),
    ...(manifest.agentMemoryMode === 'managed'
      ? { agentMemory: await exists(path.join(layout.current, 'agentmemory', '.installed')) }
      : {}),
    codeReviewGraph: await exists(path.join(layout.current, 'code-review-graph', '.installed')),
  };
  return { healthy: Object.values(checks).every(Boolean), manifest, checks };
}
