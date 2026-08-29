#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { probeRemoteAgentMemoryIsolation } from '../adapters/agentmemory/capabilities.js';
import { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { GitRepository, NO_GIT_HEAD } from '../adapters/git/repository.js';
import { createLocalLogger, type LocalLogger } from '../observability/logger.js';
import { loadConfig, loadManagedDependencyVersions } from '../config/load.js';
import type { MegaBrainConfig } from '../config/schema.js';
import { discoverProjectIdentity } from '../projects/identity.js';
import { openProvenanceDatabase } from '../provenance/database.js';
import { ProvenanceRepository } from '../provenance/repository.js';
import { runtimeLayout } from '../runtime/layout.js';
import type { RuntimeLockManifest } from '../runtime/lock-manifest.js';
import { readRuntimeState } from '../runtime/supervisor.js';
import { downloadOfficialIiiEngine } from '../runtime/iii-engine.js';
import { projectConfigPath, writeProjectConfig } from '../config/project-config.js';
import { installGitHookMultiplexer, restoreGitHooks } from '../hooks/git/install.js';
import type { MegaBrainGitHook } from '../hooks/git/multiplexer.js';
import { createApplicationHandlers } from '../server/application.js';
import { createMegaBrainServer, listenMegaBrainServer } from '../server/index.js';
import { formatDoctorReport, managedDoctorDependencies, runDoctor, runDoctorFix } from './doctor.js';
import { drainPendingDeletes } from '../runtime/pending-deletes.js';
import { handleGitHook, handleHostHook } from './hook.js';
import { installHostMcpFiles, restoreHostMcpFiles } from './host-integration.js';
import { installHostHookFiles, restoreHostHookFiles } from './host-hooks.js';
import { parseHostSelection, promptForHosts } from './host-selection.js';
import { installProjectTransaction, inspectManagedRuntime } from './install.js';
import { runMcpCommand } from './mcp.js';
import {
  createOperationProgress,
  formatUninstallFailureReport,
  formatUninstallReport,
  formatUpgradeFailureReport,
  formatUpgradeReport,
  uninstallLogMatches,
  uninstallSteps,
  upgradeLogMatches,
  upgradeSteps,
} from './operation-progress.js';
import { runInstallPreflight } from './preflight.js';
import { createTerminalPrompts } from './prompts.js';
import { runSetupWizard } from './setup.js';
import { startManagedRuntime, waitForService } from './start.js';
import { stopManagedRuntime } from './stop.js';
import { runSupervisorCommand } from './supervisor.js';
import { drainProjectSupervisor, uninstallMegaBrain } from './uninstall.js';
import { upgradeManagedRuntime } from './upgrade.js';
import { snapshotFile, type RuntimeTransaction } from '../runtime/transaction.js';

const execFileAsync = promisify(execFile);
const REMOTE_AGENTMEMORY_SETUP_TIMEOUT_MS = 30_000;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function isRuntimeActive(dataDir: string, identity: Awaited<ReturnType<typeof discoverProjectIdentity>>): Promise<boolean> {
  try {
    await readRuntimeState(runtimeLayout(dataDir, identity));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function runtimeSwapLifecycle(
  config: MegaBrainConfig,
  identity: Awaited<ReturnType<typeof discoverProjectIdentity>>,
  options: {
    runtimeWasActive: boolean;
    logger?: LocalLogger;
    drain?: () => Promise<void>;
    stop?: () => Promise<void>;
    start?: () => Promise<void>;
  },
): Pick<Parameters<typeof installProjectTransaction>[0], 'beforeSwap' | 'afterSwap'> {
  const start = options.start ?? (() => startManagedRuntime(config.dataDir, identity, {
    agentMemoryMode: config.agentMemory.mode,
    agentMemoryEnvironment: config.agentMemory.environment,
  }).then(() => undefined));
  const stop = options.stop ?? (() => stopManagedRuntime(config.dataDir, identity));
  const drain = options.drain ?? (() => drainProjectSupervisor({ dataDir: config.dataDir, identity, stopRuntime: stop }));
  return {
    async beforeSwap(transaction: RuntimeTransaction) {
      options.logger?.log('info', 'install: draining existing runtime before swap', {
        project: identity.worktreeId,
        runtimeWasActive: options.runtimeWasActive,
      });
      await drain();
      if (options.runtimeWasActive) transaction.addRollback(start);
    },
    async afterSwap(transaction: RuntimeTransaction) {
      if (!options.runtimeWasActive) return;
      options.logger?.log('info', 'install: restarting previously active runtime after swap', { project: identity.worktreeId });
      transaction.addRollback(stop);
      await start();
    },
  };
}

async function isRuntimeInstalled(dataDir: string, identity: Awaited<ReturnType<typeof discoverProjectIdentity>>): Promise<boolean> {
  try {
    await access(runtimeLayout(dataDir, identity).current);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function runtimeSwapForExistingInstall(
  config: MegaBrainConfig,
  identity: Awaited<ReturnType<typeof discoverProjectIdentity>>,
  logger: LocalLogger,
): Promise<Pick<Parameters<typeof installProjectTransaction>[0], 'beforeSwap' | 'afterSwap'>> {
  const [runtimeWasActive, runtimeInstalled] = await Promise.all([
    isRuntimeActive(config.dataDir, identity),
    isRuntimeInstalled(config.dataDir, identity),
  ]);
  if (!runtimeWasActive && !runtimeInstalled) return {};
  return runtimeSwapLifecycle(config, identity, { runtimeWasActive, logger });
}

function mcpEndpoint(args: string[]): string {
  const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  return `http://127.0.0.1:${port}/mcp`;
}

function currentCliPath(): string {
  return fileURLToPath(import.meta.url);
}

export function currentCliStdioConnection(args: string[]): { transport: 'stdio'; command: string; args: string[] } {
  return { transport: 'stdio', command: process.execPath, args: ['--no-warnings', currentCliPath(), ...args] };
}

function shellCommandPart(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function currentCliShellCommand(args: string[]): string {
  return [process.execPath, '--no-warnings', currentCliPath(), ...args].map(shellCommandPart).join(' ');
}

export function currentCliArgv(): string[] {
  return [process.execPath, '--no-warnings', currentCliPath()];
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function readStdin(): Promise<Record<string, unknown>> {
  const raw = await readStdinText();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function optionalGitRepository(identity: Awaited<ReturnType<typeof discoverProjectIdentity>>, logger: LocalLogger): Promise<GitRepository | null> {
  if (!identity.gitBacked) {
    logger.log('warn', 'cli: Git repository not found; Git hook integration and Git evidence will be skipped', { repo: identity.root });
    return null;
  }
  return GitRepository.discover(identity.root);
}

async function projectContext(args: string[], logger?: LocalLogger) {
  const repo = path.resolve(option(args, '--repo') ?? process.cwd());
  const configPath = option(args, '--config');
  logger?.log('info', 'cli: resolving project context', { repo, ...(configPath ? { configPath: path.resolve(configPath) } : {}) });
  const config = await loadConfig({ repoPath: repo, ...(configPath ? { filePath: configPath } : {}) });
  const dependencyVersions = (await loadManagedDependencyVersions({ repoPath: repo })).versions;
  const identity = await discoverProjectIdentity(repo);
  logger?.log('info', identity.gitBacked ? 'cli: Git project identity discovered' : 'cli: directory project identity discovered', {
    repo: identity.root,
    project: identity.worktreeId,
    gitBacked: identity.gitBacked,
  });
  await drainPendingDeletes(config.dataDir).catch(() => undefined);
  return { repo, config, identity, dependencyVersions };
}

export function createAgentMemoryClient(
  config: MegaBrainConfig,
  fetch?: typeof globalThis.fetch,
  manifest?: RuntimeLockManifest,
): AgentMemoryClient {
  const baseUrl = config.agentMemory.mode === 'managed' && manifest?.isolation
    ? `http://127.0.0.1:${manifest.isolation.ports.rest}`
    : config.agentMemory.baseUrl;
  return new AgentMemoryClient({
    baseUrl,
    ...(config.agentMemory.authToken ? { authToken: config.agentMemory.authToken } : {}),
    ...(fetch ? { fetch } : {}),
  });
}

export async function main(args = process.argv.slice(2), output: (value: string) => void = console.log): Promise<void> {
  const [command = 'help'] = args;
  const logger = createLocalLogger();
  if (command !== 'help' && !flag(args, '--help')) {
    logger.log('info', 'cli: command started', { command, repo: path.resolve(option(args, '--repo') ?? process.cwd()) });
  }
  if (command === 'serve') {
    const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
    const { config, identity } = await projectContext(args, logger);
    const git = await optionalGitRepository(identity, logger);
    const installed = await inspectManagedRuntime(config.dataDir, identity).catch(() => null);
    const agentMemory = createAgentMemoryClient(config, undefined, installed?.manifest);
    const crgRuntime = installed?.manifest.backends.codeReviewGraph;
    const crgDataDir = crgRuntime?.environment?.CRG_DATA_DIR ?? config.codeReviewGraph.dataDir;
    const codeReviewGraph = new CodeReviewGraphClient({
      command: crgRuntime?.command ?? config.codeReviewGraph.command,
      ...(crgRuntime ? { args: crgRuntime.args } : config.codeReviewGraph.args.length ? { args: config.codeReviewGraph.args } : {}),
      cwd: crgRuntime?.cwd ?? identity.root,
      environment: { ...crgRuntime?.environment, ...config.codeReviewGraph.environment },
      repoRoot: crgRuntime?.environment?.CRG_REPO_ROOT ?? identity.root,
      ...(crgDataDir ? { dataDir: crgDataDir } : {}),
    });
    const layout = runtimeLayout(config.dataDir, identity);
    const database = openProvenanceDatabase(path.join(layout.projectRoot, 'provenance.sqlite'));
    const application = createMegaBrainServer(createApplicationHandlers({
      config,
      identity,
      git,
      agentMemory,
      codeReviewGraph,
      provenance: new ProvenanceRepository(database),
    }));
    const close = async () => {
      await application.close().catch(() => undefined);
      await codeReviewGraph.stop().catch(() => undefined);
      database.close();
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
    await listenMegaBrainServer(application, port);
    return;
  }
  if (command === 'help' || flag(args, '--help')) {
    output('Usage: mega-brain <setup|mcp|serve|start|stop|doctor|upgrade|uninstall> [--repo PATH] [--config FILE] [--transport stdio|http] [--python COMMAND] [--port PORT] [--accept-iii-engine] [--purge] [--json]');
    return;
  }
  if (command === 'setup') {
    const prompts = createTerminalPrompts();
    const setupPython = option(args, '--python');
    const result = await runSetupWizard({
      prompts,
      currentDirectory: path.resolve(option(args, '--repo') ?? process.cwd()),
      defaultDataDir: path.join(
        process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'),
        'mega-brain',
      ),
      environment: process.env,
      preflight: (_repository) => runInstallPreflight({ ...(setupPython ? { pythonCommand: setupPython } : {}) }),
      discoverIdentity: discoverProjectIdentity,
      initializeGit: async (repository) => {
        await execFileAsync('git', ['-C', repository, 'init'], { encoding: 'utf8', windowsHide: true });
      },
      probeRemote: ({ baseUrl, secret, identity }) => probeRemoteAgentMemoryIsolation(
        new AgentMemoryClient({ baseUrl, authToken: secret, timeoutMs: REMOTE_AGENTMEMORY_SETUP_TIMEOUT_MS }),
        {
          projectA: identity.worktreeId,
          projectB: `${identity.worktreeId}-isolation-control`,
          sentinel: `mega-brain-setup-probe-${randomUUID()}`,
        },
      ),
      async install(plan) {
        const iiiArtifact = plan.iiiEngineConfirmed ? await downloadOfficialIiiEngine({ version: plan.dependencyVersions.iiiEngine }) : undefined;
        const repository = await optionalGitRepository(plan.identity, logger);
        const layout = runtimeLayout(plan.config.dataDir, plan.identity);
        const backupDir = path.join(layout.projectRoot, 'integration-backups');
        const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
        const runtimeSwap = await runtimeSwapForExistingInstall(plan.config, plan.identity, logger);
        await installProjectTransaction({
          dataDir: plan.config.dataDir,
          identity: plan.identity,
          agentMemoryMode: plan.config.agentMemory.mode,
          pythonCommand: plan.preflight.pythonCommand,
          preflight: false,
          platform: plan.preflight.platform,
          dependencyVersions: plan.dependencyVersions,
          codeReviewGraph: plan.codeReviewGraphMode === 'managed'
            ? { mode: 'managed' }
            : { mode: 'custom', command: plan.config.codeReviewGraph.command, args: plan.config.codeReviewGraph.args },
          ...(iiiArtifact ? {
            iiiEngine: {
              confirmed: true,
              expectedSha256: iiiArtifact.sha256,
              download: async () => iiiArtifact.bytes,
            },
          } : {}),
          ...(plan.config.agentMemory.mode === 'remote' ? {
            remoteAgentMemory: {
              baseUrl: plan.config.agentMemory.baseUrl,
            },
            remoteIsolationProbe: () => probeRemoteAgentMemoryIsolation(new AgentMemoryClient({
              baseUrl: plan.config.agentMemory.baseUrl,
              ...(plan.config.agentMemory.authToken ? { authToken: plan.config.agentMemory.authToken } : {}),
              timeoutMs: REMOTE_AGENTMEMORY_SETUP_TIMEOUT_MS,
            }), {
              projectA: plan.identity.worktreeId,
              projectB: `${plan.identity.worktreeId}-isolation-control`,
              sentinel: `mega-brain-install-probe-${randomUUID()}`,
            }),
          } : {}),
          ...runtimeSwap,
          logger,
          async configure(transaction) {
            await snapshotFile(transaction, projectConfigPath(plan.identity.root));
            await writeProjectConfig(plan.identity.root, plan.config);
            await installHostMcpFiles({
              root: plan.identity.root,
              backupDir,
              hosts: plan.hosts,
              connection: currentCliStdioConnection(['mcp', '--repo', plan.identity.root]),
              transaction,
            });
            for (const host of plan.hosts) {
              await installHostHookFiles({ root: plan.identity.root, backupDir, hosts: [host], command: currentCliShellCommand(['hook', 'host', host]), transaction });
            }
            if (repository) await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: currentCliArgv(), transaction });
          },
        });
      },
    });
    if (result.status === 'cancelled') prompts.notify('Setup cancelled; no changes were applied.');
    return;
  }
  const pythonOption = option(args, '--python');
  const { config, identity, dependencyVersions } = await projectContext(args, logger);
  const layout = runtimeLayout(config.dataDir, identity);
  if (command === 'upgrade' && !identity.gitBacked && config.codeReviewGraph.command === 'code-review-graph') {
    throw new Error('Managed Code Review Graph requires a Git repository. Run git init in this project, or use mega-brain setup to initialize Git interactively before upgrade continues.');
  }
  if (command === 'mcp') {
    await runMcpCommand({ config, identity, logger });
    return;
  }
  if (command === 'supervisor') {
    const inspection = await inspectManagedRuntime(config.dataDir, identity);
    await startManagedRuntime(config.dataDir, identity, {
      agentMemoryMode: config.agentMemory.mode,
      agentMemoryEnvironment: config.agentMemory.environment,
      ready: () => waitForService(async () => {
        const health = await createAgentMemoryClient(config, undefined, inspection.manifest).health();
        if (!(health.healthy ?? (health.status === 'ok' || health.status === 'healthy'))) {
          throw new Error('AgentMemory health endpoint is not healthy');
        }
      }, { consecutiveSuccesses: 3 }),
    });
    const supervisor = await runSupervisorCommand({
      dataDir: config.dataDir,
      identity,
      onShutdown: () => stopManagedRuntime(config.dataDir, identity),
    });
    const close = () => { void supervisor.close(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    try { await supervisor.closed; }
    finally {
      process.off('SIGINT', close);
      process.off('SIGTERM', close);
      await supervisor.close();
      await stopManagedRuntime(config.dataDir, identity);
    }
    return;
  }
  if (command === 'hook') {
    const kind = args[1];
    if (kind === 'host' && (args[2] === 'codex' || args[2] === 'claude')) {
      output(JSON.stringify(await handleHostHook({ host: args[2], payload: await readStdin(), config, identity })));
      return;
    }
    if (kind === 'git' && ['post-commit', 'post-checkout', 'post-merge', 'post-rewrite'].includes(args[2] ?? '')) {
      output(JSON.stringify(await handleGitHook({
        event: args[2] as MegaBrainGitHook,
        config,
        identity,
        hookArgs: args.slice(3),
        stdin: await readStdinText(),
      })));
      return;
    }
    throw new Error('Usage: mega-brain hook <host codex|host claude|git EVENT>');
  }
  if (command === 'start') {
    const inspection = await inspectManagedRuntime(config.dataDir, identity);
    output(JSON.stringify(await startManagedRuntime(config.dataDir, identity, {
      agentMemoryMode: config.agentMemory.mode,
      agentMemoryEnvironment: config.agentMemory.environment,
      ready: () => waitForService(async () => {
        const health = await createAgentMemoryClient(config, undefined, inspection.manifest).health();
        if (!(health.healthy ?? (health.status === 'ok' || health.status === 'healthy'))) {
          throw new Error('AgentMemory health endpoint is not healthy');
        }
      }, { consecutiveSuccesses: 3 }),
    })));
    return;
  }
  if (command === 'stop') {
    await stopManagedRuntime(config.dataDir, identity);
    output(JSON.stringify({ stopped: true }));
    return;
  }
  if (command === 'upgrade') {
    const init = flag(args, '--init');
    const runtimeInstalled = await isRuntimeInstalled(config.dataDir, identity);
    if (!runtimeInstalled && !init) {
      throw new Error('Mega Brain is not installed in this project. Run "mega-brain setup" first, or pass "--init" to initialize during upgrade.');
    }
    const jsonOutput = flag(args, '--json');
    const prompts = createTerminalPrompts();
    const progress = createOperationProgress({
      title: 'Mega Brain upgrade',
      steps: upgradeSteps({
        agentMemoryMode: config.agentMemory.mode,
        managedIiiEngineRequired: config.agentMemory.mode === 'managed' && process.platform === 'win32',
        managedCodeReviewGraph: config.codeReviewGraph.command === 'code-review-graph',
      }),
      enabled: !jsonOutput,
    });
    const progressLogger = progress.logger(upgradeLogMatches, logger);
    try {
      const upgradePreflight = await progress.run('preflight', () => runInstallPreflight({ ...(pythonOption ? { pythonCommand: pythonOption } : {}) }));
      if (config.agentMemory.mode === 'managed' && upgradePreflight.managedIiiEngineRequired && !flag(args, '--accept-iii-engine')) {
        if (!prompts.interactive || jsonOutput) {
          throw new Error('Managed AgentMemory on Windows requires --accept-iii-engine before any download or file change');
        }
        const confirmed = await prompts.confirm('iiiEngine', `Download and verify iii-engine ${dependencyVersions.iiiEngine} inside this project runtime?`, true);
        if (!confirmed) {
          const error = new Error('iii-engine confirmation is required for managed AgentMemory on Windows');
          progress.fail('iii-engine', error);
          progress.close();
          output(formatUpgradeFailureReport({ error, steps: progress.snapshot() }));
          return;
        }
      }
      const iiiArtifact = config.agentMemory.mode === 'managed' && upgradePreflight.managedIiiEngineRequired
        ? await progress.run('iii-engine', () => downloadOfficialIiiEngine({ version: dependencyVersions.iiiEngine }), 'download official artifact')
        : undefined;
      const runtimeSwap = await runtimeSwapForExistingInstall(config, identity, progressLogger);
      const inspection = await upgradeManagedRuntime({
        dataDir: config.dataDir,
        identity,
        agentMemoryMode: config.agentMemory.mode,
        pythonCommand: upgradePreflight.pythonCommand,
        preflight: false,
        platform: upgradePreflight.platform,
        dependencyVersions,
        codeReviewGraph: config.codeReviewGraph.command === 'code-review-graph'
          ? { mode: 'managed' }
          : { mode: 'custom', command: config.codeReviewGraph.command, args: config.codeReviewGraph.args },
        ...(iiiArtifact ? {
          iiiEngine: {
            confirmed: true,
            expectedSha256: iiiArtifact.sha256,
            download: async () => iiiArtifact.bytes,
          },
        } : {}),
        ...(config.agentMemory.mode === 'remote' ? {
          remoteAgentMemory: {
            baseUrl: config.agentMemory.baseUrl,
          },
          remoteIsolationProbe: () => probeRemoteAgentMemoryIsolation(new AgentMemoryClient({
            baseUrl: config.agentMemory.baseUrl,
            ...(config.agentMemory.authToken ? { authToken: config.agentMemory.authToken } : {}),
            timeoutMs: REMOTE_AGENTMEMORY_SETUP_TIMEOUT_MS,
          }), {
            projectA: identity.worktreeId,
            projectB: `${identity.worktreeId}-isolation-control`,
            sentinel: `mega-brain-upgrade-probe-${randomUUID()}`,
          }),
        } : {}),
        ...runtimeSwap,
        logger: progressLogger,
        async configure(transaction) {
          const hosts = parseHostSelection(option(args, '--hosts'));
          if (hosts && hosts.length > 0) {
            const backupDir = path.join(layout.projectRoot, 'integration-backups');
            const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
            const repository = await optionalGitRepository(identity, logger);
            await snapshotFile(transaction, projectConfigPath(identity.root));
            await writeProjectConfig(identity.root, config);
            await installHostMcpFiles({
              root: identity.root,
              backupDir,
              hosts,
              connection: currentCliStdioConnection(['mcp', '--repo', identity.root]),
              transaction,
            });
            for (const host of hosts) {
              await installHostHookFiles({ root: identity.root, backupDir, hosts: [host], command: currentCliShellCommand(['hook', 'host', host]), transaction });
            }
            if (repository) await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: currentCliArgv(), transaction });
          }
        },
      });
      progress.completeOpenSteps();
      progress.close();
      output(jsonOutput ? JSON.stringify(inspection) : formatUpgradeReport({ identity, inspection, steps: progress.snapshot() }));
    } catch (error) {
      const runningStep = progress.snapshot().find((step) => step.status === 'running')?.id ?? 'inspect-runtime';
      progress.fail(runningStep, error);
      progress.close();
      if (!jsonOutput) output(formatUpgradeFailureReport({ error, steps: progress.snapshot() }));
      throw error;
    }
    return;
  }
  if (command === 'uninstall') {
    const prompts = createTerminalPrompts();
    const hosts = parseHostSelection(option(args, '--hosts')) ?? await promptForHosts(prompts, 'Remove Mega Brain from which hosts?');
    if (hosts === null) { prompts.notify('Uninstall cancelled; no changes were applied.'); return; }
    const transport = option(args, '--transport') ?? 'stdio';
    if (transport !== 'stdio' && transport !== 'http') throw new Error('Invalid --transport; expected stdio or http');
    const configPath = option(args, '--config');
    const connection = transport === 'http'
      ? { transport: 'http' as const, url: mcpEndpoint(args) }
      : currentCliStdioConnection(['mcp', '--repo', identity.root, ...(configPath ? ['--config', path.resolve(configPath)] : [])]);
    const repository = await optionalGitRepository(identity, logger);
    const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
    const hostBackupDir = path.join(layout.projectRoot, 'integration-backups');
    const purge = flag(args, '--purge');
    const jsonOutput = flag(args, '--json');
    const progress = createOperationProgress({
      title: 'Mega Brain uninstall',
      steps: uninstallSteps({ repository: Boolean(repository), purge }),
      enabled: !jsonOutput,
    });
    const progressLogger = progress.logger(uninstallLogMatches, logger);
    try {
      const runtimeWasActive = await progress.run('runtime-active', () => isRuntimeActive(config.dataDir, identity));
      const result = await uninstallMegaBrain({
        dataDir: config.dataDir,
        identity,
        purge,
        logger: progressLogger,
        drain: () => progress.run('runtime-drain', () => drainProjectSupervisor({ dataDir: config.dataDir, identity })),
        ...(runtimeWasActive ? {
          resume: () => startManagedRuntime(config.dataDir, identity, {
            agentMemoryMode: config.agentMemory.mode,
            agentMemoryEnvironment: config.agentMemory.environment,
          }).then(() => undefined),
        } : {}),
        participants: [
          {
            apply: async () => {
              await progress.run('host-hooks', () => restoreHostHookFiles({ root: identity.root, backupDir: hostBackupDir, hosts }));
              await progress.run('mcp-files', () => restoreHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts }));
            },
            rollback: async () => {
              await installHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts, connection });
              for (const host of hosts) {
                await installHostHookFiles({ root: identity.root, backupDir: hostBackupDir, hosts: [host], command: currentCliShellCommand(['hook', 'host', host]) });
              }
            },
          },
          ...(repository ? [{
            apply: () => progress.run('git-hooks', () => restoreGitHooks(repository, managedHooksPath)),
            rollback: () => installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: currentCliArgv() }).then(() => undefined),
          }] : []),
        ],
      });
      progress.completeOpenSteps();
      progress.close();
      output(jsonOutput ? JSON.stringify(result) : formatUninstallReport({ hosts, purge, result, steps: progress.snapshot() }));
    } catch (error) {
      const runningStep = progress.snapshot().find((step) => step.status === 'running')?.id ?? 'project-config';
      progress.fail(runningStep, error);
      progress.close();
      if (!jsonOutput) output(formatUninstallFailureReport({ error, steps: progress.snapshot() }));
      throw error;
    }
    return;
  }
  if (command === 'doctor') {
    const fix = flag(args, '--fix');
    if (fix) {
      const fixed = await runDoctorFix({ dataDir: config.dataDir, identity, layout });
      if (!flag(args, '--json')) {
        output(`Doctor fix complete: ${fixed.purged.length} pending delete paths purged, ${fixed.swept.length} orphan processes terminated.`);
      }
    }
    let inspection: Awaited<ReturnType<typeof inspectManagedRuntime>> | undefined;
    try {
      inspection = await inspectManagedRuntime(config.dataDir, identity);
    } catch {
      inspection = undefined;
    }
    const repository = await optionalGitRepository(identity, logger);
    const agentMemory = createAgentMemoryClient(config, undefined, inspection?.manifest);
    const crgCommand = inspection?.manifest?.backends?.codeReviewGraph;
    const crgDataDir = crgCommand?.environment?.CRG_DATA_DIR ?? config.codeReviewGraph.dataDir;
    const codeReviewGraph = new CodeReviewGraphClient({
      command: crgCommand?.command ?? config.codeReviewGraph.command,
      args: crgCommand?.args ?? config.codeReviewGraph.args,
      cwd: crgCommand?.cwd ?? identity.root,
      environment: { ...(crgCommand?.environment ?? {}), ...config.codeReviewGraph.environment },
      repoRoot: crgCommand?.environment?.CRG_REPO_ROOT ?? identity.root,
      ...(crgDataDir ? { dataDir: crgDataDir } : {}),
    });
    try {
      const result = await runDoctor({
        project: identity.worktreeId,
        hooksHealthy: true,
        queueDepth: 0,
        config,
      }, managedDoctorDependencies({
        dataDir: config.dataDir,
        identity,
        agentMemory,
        codeReviewGraph,
        gitHead: () => repository ? repository.head() : Promise.resolve(NO_GIT_HEAD),
      }));
      output(flag(args, '--json') ? JSON.stringify(result) : formatDoctorReport(result));
    } finally {
      await codeReviewGraph.stop().catch(() => undefined);
    }
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

const invoked = isDirectInvocation();
if (invoked) {
  main().then(() => {
    if (process.argv[2] === 'supervisor' || process.argv[2] === 'mcp') {
      process.exit(0);
    }
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
