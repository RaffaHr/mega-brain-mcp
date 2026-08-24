#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { GitRepository } from '../adapters/git/repository.js';
import { loadConfig } from '../config/load.js';
import { discoverProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import server from '../server/index.js';
import { managedDoctorDependencies, runDoctor } from './doctor.js';
import { installManagedRuntime, inspectManagedRuntime } from './install.js';
import { startManagedRuntime } from './start.js';
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

async function projectContext(args: string[]) {
  const repo = path.resolve(option(args, '--repo') ?? process.cwd());
  const configPath = option(args, '--config');
  const config = await loadConfig(configPath ? { filePath: configPath } : {});
  const identity = await discoverProjectIdentity(repo);
  return { repo, config, identity };
}

export async function main(args = process.argv.slice(2), output: (value: string) => void = console.log): Promise<void> {
  const [command = 'help'] = args;
  if (command === 'serve') {
    const port = Number(option(args, '--port') ?? process.env.MEGA_BRAIN_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
    await server.listen(port);
    return;
  }
  if (command === 'help' || flag(args, '--help')) {
    output('Usage: mega-brain <serve|install|start|stop|doctor|upgrade|uninstall> [--repo PATH] [--config FILE]');
    return;
  }
  const { config, identity } = await projectContext(args);
  if (command === 'install') {
    output(JSON.stringify(await installManagedRuntime({ dataDir: config.dataDir, identity })));
    return;
  }
  if (command === 'start') {
    output(JSON.stringify(await startManagedRuntime(config.dataDir, identity)));
    return;
  }
  if (command === 'stop') {
    await stopManagedRuntime(config.dataDir, identity);
    output(JSON.stringify({ stopped: true }));
    return;
  }
  if (command === 'upgrade') {
    output(JSON.stringify(await upgradeManagedRuntime({ dataDir: config.dataDir, identity })));
    return;
  }
  if (command === 'uninstall') {
    output(JSON.stringify(await uninstallMegaBrain({ dataDir: config.dataDir, identity, purge: flag(args, '--purge') })));
    return;
  }
  if (command === 'doctor') {
    const inspection = await inspectManagedRuntime(config.dataDir, identity);
    const repository = await GitRepository.discover(identity.root);
    const agentMemory = new AgentMemoryClient({
      baseUrl: config.agentMemory.baseUrl,
      ...(config.agentMemory.authToken ? { authToken: config.agentMemory.authToken } : {}),
    });
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

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
