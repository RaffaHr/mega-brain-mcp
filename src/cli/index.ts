#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { GitRepository } from '../adapters/git/repository.js';
import { loadConfig } from '../config/load.js';
import type { MegaBrainConfig } from '../config/schema.js';
import { discoverProjectIdentity } from '../projects/identity.js';
import { openProvenanceDatabase } from '../provenance/database.js';
import { ProvenanceRepository } from '../provenance/repository.js';
import { runtimeLayout } from '../runtime/layout.js';
import { installGitHookMultiplexer, restoreGitHooks } from '../hooks/git/install.js';
import type { MegaBrainGitHook } from '../hooks/git/multiplexer.js';
import { createApplicationHandlers } from '../server/application.js';
import { createMegaBrainServer, listenMegaBrainServer } from '../server/index.js';
import { managedDoctorDependencies, runDoctor } from './doctor.js';
import { handleGitHook, handleHostHook } from './hook.js';
import { installHostMcpFiles, restoreHostMcpFiles } from './host-integration.js';
import { installHostHookFiles, parseHosts, restoreHostHookFiles } from './host-hooks.js';
import { installManagedRuntime, inspectManagedRuntime } from './install.js';
import { runInstallPreflight } from './preflight.js';
import { startManagedRuntime, waitForService } from './start.js';
import { stopManagedRuntime } from './stop.js';
import { uninstallMegaBrain } from './uninstall.js';
import { upgradeManagedRuntime } from './upgrade.js';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function mcpEndpoint(args: string[]): string {
  const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  return `http://localhost:${port}/mcp`;
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
    const codeReviewGraph = new CodeReviewGraphClient({
      command: crgRuntime?.command ?? config.codeReviewGraph.command,
      ...(crgRuntime ? { args: crgRuntime.args } : config.codeReviewGraph.args.length ? { args: config.codeReviewGraph.args } : {}),
      cwd: crgRuntime?.cwd ?? identity.root,
      environment: config.codeReviewGraph.environment,
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
    output('Usage: mega-brain <serve|install|start|stop|doctor|upgrade|uninstall> [--repo PATH] [--config FILE] [--hosts codex,claude] [--python COMMAND] [--port PORT]');
    return;
  }
  const pythonOption = option(args, '--python');
  const installPreflight = command === 'install' || command === 'upgrade'
    ? await runInstallPreflight({ ...(pythonOption ? { pythonCommand: pythonOption } : {}) })
    : null;
  const { config, identity } = await projectContext(args);
  const layout = runtimeLayout(config.dataDir, identity);
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
    const endpoint = mcpEndpoint(args);
    const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
    const hostBackupDir = path.join(layout.projectRoot, 'integration-backups');
    const manifest = await installManagedRuntime({
      dataDir: config.dataDir,
      identity,
      agentMemoryMode: config.agentMemory.mode,
      pythonCommand: installPreflight!.pythonCommand,
      preflight: false,
    });
    try {
      await installHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts, endpoint });
      await installHostHookFiles({ root: identity.root, backupDir: hostBackupDir, hosts });
      await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] });
    } catch (error) {
      await restoreHostMcpFiles(hostBackupDir, hosts).catch(() => undefined);
      await restoreHostHookFiles(hostBackupDir, hosts).catch(() => undefined);
      await restoreGitHooks(repository, managedHooksPath).catch(() => undefined);
      throw error;
    }
    output(JSON.stringify({ manifest, hosts, endpoint, hooksInstalled: true, mcpConfigured: true }));
    return;
  }
  if (command === 'start') {
    output(JSON.stringify(await startManagedRuntime(config.dataDir, identity, {
      agentMemoryMode: config.agentMemory.mode,
      agentMemoryEnvironment: config.agentMemory.environment,
      ready: () => waitForService(() => createAgentMemoryClient(config).livez()),
    })));
    return;
  }
  if (command === 'stop') {
    await stopManagedRuntime(config.dataDir, identity);
    output(JSON.stringify({ stopped: true }));
    return;
  }
  if (command === 'upgrade') {
    output(JSON.stringify(await upgradeManagedRuntime({
      dataDir: config.dataDir,
      identity,
      agentMemoryMode: config.agentMemory.mode,
      pythonCommand: installPreflight!.pythonCommand,
      preflight: false,
    })));
    return;
  }
  if (command === 'uninstall') {
    const hosts = parseHosts(option(args, '--hosts'));
    const endpoint = mcpEndpoint(args);
    const repository = await GitRepository.discover(identity.root);
    const managedHooksPath = path.join(layout.projectRoot, 'hooks', 'git');
    const hostBackupDir = path.join(layout.projectRoot, 'integration-backups');
    output(JSON.stringify(await uninstallMegaBrain({
      dataDir: config.dataDir,
      identity,
      purge: flag(args, '--purge'),
      participants: [
        {
          apply: async () => {
            await restoreHostHookFiles(hostBackupDir, hosts);
            await restoreHostMcpFiles(hostBackupDir, hosts);
          },
          rollback: async () => {
            await installHostMcpFiles({ root: identity.root, backupDir: hostBackupDir, hosts, endpoint });
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
    const codeReviewGraph = new CodeReviewGraphClient({
      command: crgCommand.command,
      args: crgCommand.args,
      cwd: crgCommand.cwd,
      environment: config.codeReviewGraph.environment,
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
