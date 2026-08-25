#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { probeRemoteAgentMemoryIsolation } from '../adapters/agentmemory/capabilities.js';
import { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { GitRepository } from '../adapters/git/repository.js';
import { loadConfig } from '../config/load.js';
import type { MegaBrainConfig } from '../config/schema.js';
import { discoverProjectIdentity } from '../projects/identity.js';
import { openProvenanceDatabase } from '../provenance/database.js';
import { ProvenanceRepository } from '../provenance/repository.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readRuntimeState } from '../runtime/supervisor.js';
import { downloadOfficialIiiEngine } from '../runtime/iii-engine.js';
import { projectConfigPath, writeProjectConfig } from '../config/project-config.js';
import { installGitHookMultiplexer, restoreGitHooks } from '../hooks/git/install.js';
import type { MegaBrainGitHook } from '../hooks/git/multiplexer.js';
import { createApplicationHandlers } from '../server/application.js';
import { createMegaBrainServer, listenMegaBrainServer } from '../server/index.js';
import { managedDoctorDependencies, runDoctor } from './doctor.js';
import { handleGitHook, handleHostHook } from './hook.js';
import { installHostMcpFiles, restoreHostMcpFiles } from './host-integration.js';
import { installHostHookFiles, parseHosts, restoreHostHookFiles } from './host-hooks.js';
import { installProjectTransaction, inspectManagedRuntime } from './install.js';
import { runMcpCommand } from './mcp.js';
import { runInstallPreflight } from './preflight.js';
import { createTerminalPrompts } from './prompts.js';
import { runSetupWizard } from './setup.js';
import { startManagedRuntime, waitForService } from './start.js';
import { stopManagedRuntime } from './stop.js';
import { runSupervisorCommand } from './supervisor.js';
import { drainProjectSupervisor, uninstallMegaBrain } from './uninstall.js';
import { upgradeManagedRuntime } from './upgrade.js';
import { snapshotFile, type RuntimeTransaction } from '../runtime/transaction.js';

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

function activeRuntimeSwap(
  config: MegaBrainConfig,
  identity: Awaited<ReturnType<typeof discoverProjectIdentity>>,
): Pick<Parameters<typeof installProjectTransaction>[0], 'beforeSwap' | 'afterSwap'> {
  const start = () => startManagedRuntime(config.dataDir, identity, {
    agentMemoryMode: config.agentMemory.mode,
    agentMemoryEnvironment: config.agentMemory.environment,
  }).then(() => undefined);
  const stop = () => stopManagedRuntime(config.dataDir, identity);
  return {
    async beforeSwap(transaction: RuntimeTransaction) {
      await stop();
      transaction.addRollback(start);
    },
    async afterSwap(transaction: RuntimeTransaction) {
      transaction.addRollback(stop);
      await start();
    },
  };
}

function mcpEndpoint(args: string[]): string {
  const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  return `http://127.0.0.1:${port}/mcp`;
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

async function projectContext(args: string[]) {
  const repo = path.resolve(option(args, '--repo') ?? process.cwd());
  const configPath = option(args, '--config');
  const config = await loadConfig({ repoPath: repo, ...(configPath ? { filePath: configPath } : {}) });
  const identity = await discoverProjectIdentity(repo);
  return { repo, config, identity };
}

export function createAgentMemoryClient(
  config: MegaBrainConfig,
  fetch?: typeof globalThis.fetch,
): AgentMemoryClient {
  return new AgentMemoryClient({
    baseUrl: config.agentMemory.baseUrl,
    ...(config.agentMemory.authToken ? { authToken: config.agentMemory.authToken } : {}),
    ...(fetch ? { fetch } : {}),
  });
}

export async function main(args = process.argv.slice(2), output: (value: string) => void = console.log): Promise<void> {
  const [command = 'help'] = args;
  if (command === 'serve') {
    const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
    const { config, identity } = await projectContext(args);
    const git = await GitRepository.discover(identity.root);
    const agentMemory = createAgentMemoryClient(config);
    const installed = await inspectManagedRuntime(config.dataDir, identity).catch(() => null);
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
    output('Usage: mega-brain <setup|mcp|serve|install|start|stop|doctor|upgrade|uninstall> [--repo PATH] [--config FILE] [--hosts codex,claude] [--transport stdio|http] [--python COMMAND] [--port PORT] [--accept-iii-engine] [--purge]');
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
      probeRemote: ({ baseUrl, secret, identity }) => probeRemoteAgentMemoryIsolation(
        new AgentMemoryClient({ baseUrl, authToken: secret }),
        {
          projectA: identity.worktreeId,
          projectB: `${identity.worktreeId}-isolation-control`,
          sentinel: `mega-brain-setup-probe-${randomUUID()}`,
        },
      ),
      async install(plan) {
        const iiiArtifact = plan.iiiEngineConfirmed ? await downloadOfficialIiiEngine() : undefined;
        const remoteSecretEnv = plan.config.agentMemory.secretEnvVar;
        const remoteSecret = remoteSecretEnv ? process.env[remoteSecretEnv] : undefined;
        const repository = await GitRepository.discover(plan.identity.root);
        const layout = runtimeLayout(plan.config.dataDir, plan.identity);
        const backupDir = path.join(layout.projectRoot, 'integration-backups');
        const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
        const runtimeWasActive = await isRuntimeActive(plan.config.dataDir, plan.identity);
        const manifest = await installProjectTransaction({
          dataDir: plan.config.dataDir,
          identity: plan.identity,
          agentMemoryMode: plan.config.agentMemory.mode,
          pythonCommand: plan.preflight.pythonCommand,
          preflight: false,
          platform: plan.preflight.platform,
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
              secretEnvVar: remoteSecretEnv!,
            },
            remoteIsolationProbe: () => probeRemoteAgentMemoryIsolation(new AgentMemoryClient({
              baseUrl: plan.config.agentMemory.baseUrl,
              ...(remoteSecret ? { authToken: remoteSecret } : {}),
            }), {
              projectA: plan.identity.worktreeId,
              projectB: `${plan.identity.worktreeId}-isolation-control`,
              sentinel: `mega-brain-install-probe-${randomUUID()}`,
            }),
          } : {}),
          ...(runtimeWasActive ? activeRuntimeSwap(plan.config, plan.identity) : {}),
          async configure(transaction) {
            await snapshotFile(transaction, projectConfigPath(plan.identity.root));
            await writeProjectConfig(plan.identity.root, plan.config);
            await installHostMcpFiles({
              root: plan.identity.root,
              backupDir,
              hosts: plan.hosts,
              connection: { transport: 'stdio', command: 'mega-brain', args: ['mcp', '--repo', plan.identity.root] },
              transaction,
            });
            await installHostHookFiles({ root: plan.identity.root, backupDir, hosts: plan.hosts, transaction });
            await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'], transaction });
          },
        });
        prompts.notify(`Setup complete for ${manifest.project.worktreeId}. Reopen ${plan.hosts.join(' and ')} to start Mega Brain automatically.`);
      },
    });
    if (result.status === 'cancelled') prompts.notify('Setup cancelled; no changes were applied.');
    return;
  }
  const pythonOption = option(args, '--python');
  const installPreflight = command === 'install' || command === 'upgrade'
    ? await runInstallPreflight({ ...(pythonOption ? { pythonCommand: pythonOption } : {}) })
    : null;
  const { config, identity } = await projectContext(args);
  const layout = runtimeLayout(config.dataDir, identity);
  if (command === 'mcp') {
    await runMcpCommand({ config, identity });
    return;
  }
  if (command === 'supervisor') {
    await startManagedRuntime(config.dataDir, identity, {
      agentMemoryMode: config.agentMemory.mode,
      agentMemoryEnvironment: config.agentMemory.environment,
      ready: () => waitForService(async () => {
        const health = await createAgentMemoryClient(config).health();
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
  if (command === 'install') {
    const hosts = parseHosts(option(args, '--hosts'));
    const repository = await GitRepository.discover(identity.root);
    const transport = option(args, '--transport') ?? 'stdio';
    if (transport !== 'stdio' && transport !== 'http') throw new Error('Invalid --transport; expected stdio or http');
    const configPath = option(args, '--config');
    const connection = transport === 'http'
      ? { transport: 'http' as const, url: mcpEndpoint(args) }
      : {
          transport: 'stdio' as const,
          command: 'mega-brain',
          args: ['mcp', '--repo', identity.root, ...(configPath ? ['--config', path.resolve(configPath)] : [])],
        };
    const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
    const hostBackupDir = path.join(layout.projectRoot, 'integration-backups');
    if (config.agentMemory.mode === 'managed' && installPreflight!.managedIiiEngineRequired && !flag(args, '--accept-iii-engine')) {
      throw new Error('Managed AgentMemory on Windows requires --accept-iii-engine before any download or file change');
    }
    const iiiArtifact = config.agentMemory.mode === 'managed' && installPreflight!.managedIiiEngineRequired
      ? await downloadOfficialIiiEngine()
      : undefined;
    const runtimeWasActive = await isRuntimeActive(config.dataDir, identity);
    const manifest = await installProjectTransaction({
      dataDir: config.dataDir,
      identity,
      agentMemoryMode: config.agentMemory.mode,
      pythonCommand: installPreflight!.pythonCommand,
      preflight: false,
      platform: installPreflight!.platform,
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
          secretEnvVar: config.agentMemory.secretEnvVar ?? '',
        },
        remoteIsolationProbe: () => probeRemoteAgentMemoryIsolation(createAgentMemoryClient(config), {
          projectA: identity.worktreeId,
          projectB: `${identity.worktreeId}-isolation-control`,
          sentinel: `mega-brain-install-probe-${randomUUID()}`,
        }),
      } : {}),
      ...(runtimeWasActive ? activeRuntimeSwap(config, identity) : {}),
      async configure(transaction) {
        await installHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts, connection, transaction });
        await installHostHookFiles({ root: identity.root, backupDir: hostBackupDir, hosts, transaction });
        await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'], transaction });
      },
    });
    output(JSON.stringify({ manifest, hosts, connection, hooksInstalled: true, mcpConfigured: true }));
    return;
  }
  if (command === 'start') {
    output(JSON.stringify(await startManagedRuntime(config.dataDir, identity, {
      agentMemoryMode: config.agentMemory.mode,
      agentMemoryEnvironment: config.agentMemory.environment,
      ready: () => waitForService(async () => {
        const health = await createAgentMemoryClient(config).health();
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
    if (config.agentMemory.mode === 'managed' && installPreflight!.managedIiiEngineRequired && !flag(args, '--accept-iii-engine')) {
      throw new Error('Managed AgentMemory on Windows requires --accept-iii-engine before any download or file change');
    }
    const iiiArtifact = config.agentMemory.mode === 'managed' && installPreflight!.managedIiiEngineRequired
      ? await downloadOfficialIiiEngine()
      : undefined;
    const runtimeWasActive = await isRuntimeActive(config.dataDir, identity);
    output(JSON.stringify(await upgradeManagedRuntime({
      dataDir: config.dataDir,
      identity,
      agentMemoryMode: config.agentMemory.mode,
      pythonCommand: installPreflight!.pythonCommand,
      preflight: false,
      platform: installPreflight!.platform,
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
          secretEnvVar: config.agentMemory.secretEnvVar ?? '',
        },
        remoteIsolationProbe: () => probeRemoteAgentMemoryIsolation(createAgentMemoryClient(config), {
          projectA: identity.worktreeId,
          projectB: `${identity.worktreeId}-isolation-control`,
          sentinel: `mega-brain-upgrade-probe-${randomUUID()}`,
        }),
      } : {}),
      ...(runtimeWasActive ? activeRuntimeSwap(config, identity) : {}),
    })));
    return;
  }
  if (command === 'uninstall') {
    const hosts = parseHosts(option(args, '--hosts'));
    const transport = option(args, '--transport') ?? 'stdio';
    if (transport !== 'stdio' && transport !== 'http') throw new Error('Invalid --transport; expected stdio or http');
    const configPath = option(args, '--config');
    const connection = transport === 'http'
      ? { transport: 'http' as const, url: mcpEndpoint(args) }
      : {
          transport: 'stdio' as const,
          command: 'mega-brain',
          args: ['mcp', '--repo', identity.root, ...(configPath ? ['--config', path.resolve(configPath)] : [])],
        };
    const repository = await GitRepository.discover(identity.root);
    const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
    const hostBackupDir = path.join(layout.projectRoot, 'integration-backups');
    const runtimeWasActive = await isRuntimeActive(config.dataDir, identity);
    output(JSON.stringify(await uninstallMegaBrain({
      dataDir: config.dataDir,
      identity,
      purge: flag(args, '--purge'),
      drain: () => drainProjectSupervisor({ dataDir: config.dataDir, identity }),
      ...(runtimeWasActive ? {
        resume: () => startManagedRuntime(config.dataDir, identity, {
          agentMemoryMode: config.agentMemory.mode,
          agentMemoryEnvironment: config.agentMemory.environment,
        }).then(() => undefined),
      } : {}),
      participants: [
        {
          apply: async () => {
            await restoreHostHookFiles(hostBackupDir, hosts);
            await restoreHostMcpFiles(hostBackupDir, hosts);
          },
          rollback: async () => {
            await installHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts, connection });
            await installHostHookFiles({ root: identity.root, backupDir: hostBackupDir, hosts });
          },
        },
        {
          apply: () => restoreGitHooks(repository, managedHooksPath),
          rollback: () => installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] }).then(() => undefined),
        },
      ],
    })));
    return;
  }
  if (command === 'doctor') {
    const inspection = await inspectManagedRuntime(config.dataDir, identity);
    const repository = await GitRepository.discover(identity.root);
    const agentMemory = createAgentMemoryClient(config);
    const crgCommand = inspection.manifest.backends.codeReviewGraph;
    const crgDataDir = crgCommand.environment?.CRG_DATA_DIR ?? config.codeReviewGraph.dataDir;
    const codeReviewGraph = new CodeReviewGraphClient({
      command: crgCommand.command,
      args: crgCommand.args,
      cwd: crgCommand.cwd,
      environment: { ...crgCommand.environment, ...config.codeReviewGraph.environment },
      repoRoot: crgCommand.environment?.CRG_REPO_ROOT ?? identity.root,
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
        gitHead: () => repository.head(),
      }));
      output(JSON.stringify(result));
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
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
