import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { installManagedRuntime, inspectManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { startManagedRuntime } from '../../src/cli/start.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import type { ProcessController } from '../../src/runtime/supervisor.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('AC-001: instalação cria runtime isolado e verificável @spec:AC-001', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({
    root: path.join(dataDir, 'repo'),
    gitDir: '.git',
    commonGitDir: '.git',
    remote: 'https://github.com/example/project.git',
  });
  const commands: Array<{ command: string; args: string[]; options: { cwd: string; env?: NodeJS.ProcessEnv } }> = [];
  const runner: CommandRunner = {
    async run(command, args, options) {
      commands.push({ command, args, options });
    },
  };

  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    runner,
    preflight: false,
    now: new Date('2026-08-24T12:00:00.000Z'),
  });
  const inspection = await inspectManagedRuntime(dataDir, identity);

  expect(commands).toHaveLength(4);
  expect(commands[0]?.args).toContain('@agentmemory/agentmemory@0.9.29');
  expect(commands[2]?.args).toContain('code-review-graph==2.3.7');
  expect(commands[3]?.args).toEqual(['-m', 'code_review_graph', 'build']);
  expect(commands[3]?.options.env).toMatchObject({
    CRG_DATA_DIR: manifest.isolation!.paths.codeReviewGraph,
    CRG_REPO_ROOT: path.resolve(identity.root),
  });
  expect(manifest.versions).toEqual({ megaBrain: '0.1.0', agentMemory: '0.9.29', codeReviewGraph: '2.3.7' });
  expect(inspection.healthy).toBe(true);
  expect(inspection.checks).toEqual({ project: true, isolation: true, agentMemory: true, codeReviewGraph: true });
  expect(manifest.backends.codeReviewGraph.lifecycle).toBe('on-demand');
  expect(manifest.backends.codeReviewGraph.command).toContain(path.join('runtime', 'current', 'code-review-graph'));
  expect(manifest.backends.codeReviewGraph.command).not.toContain('.staging-');
  expect(manifest.backends.agentMemory?.cwd).toContain(path.join('runtime', 'current', 'agentmemory'));
  expect(manifest.backends.agentMemory?.cwd).not.toContain('.staging-');
  expect(manifest.backends.agentMemory?.args).toEqual(expect.arrayContaining([
    '--data-dir', manifest.isolation!.paths.agentMemory,
    '--port', String(manifest.isolation!.ports.rest),
  ]));
});

test('AC-026: modo remoto instala somente Code Review Graph e nunca inicia AgentMemory local @spec:AC-026', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-remote-runtime-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({
    root: path.join(dataDir, 'repo'),
    gitDir: '.git',
    commonGitDir: '.git',
  });
  const commands: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = {
    async run(command, args) {
      commands.push({ command, args });
    },
  };

  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    agentMemoryMode: 'remote',
    remoteAgentMemory: { baseUrl: 'https://memory.example.test', secretEnvVar: 'REMOTE_MEMORY_SECRET' },
    remoteIsolationProbe: async () => undefined,
    runner,
    preflight: false,
    now: new Date('2026-08-24T12:00:00.000Z'),
  });
  const inspection = await inspectManagedRuntime(dataDir, identity);
  const starts: string[] = [];
  const controller: ProcessController = {
    async start(command) {
      starts.push(command.command);
      return { pid: 42, stop: async () => undefined };
    },
  };
  const state = await startManagedRuntime(dataDir, identity, {
    agentMemoryMode: 'remote',
    agentMemoryEnvironment: { AGENTMEMORY_SECRET: 'must-never-be-used' },
    controller,
  });

  expect(commands).toHaveLength(3);
  expect(commands.flatMap(({ args }) => args)).not.toContain('@agentmemory/agentmemory@0.9.29');
  expect(commands[1]?.args).toContain('code-review-graph==2.3.7');
  expect(manifest.agentMemoryMode).toBe('remote');
  expect(manifest.backends).not.toHaveProperty('agentMemory');
  expect(inspection.checks).toEqual({ project: true, isolation: true, codeReviewGraph: true });
  expect(manifest.remoteAgentMemory).toEqual({
    baseUrl: 'https://memory.example.test',
    secretEnvVar: 'REMOTE_MEMORY_SECRET',
  });
  expect(starts).toEqual([]);
  expect(state.processes).toEqual({});
});

test('AC-027: modo gerenciado injeta ambiente no spawn sem persistir secrets @spec:AC-027 @principle:P-002', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-managed-runtime-env-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({
    root: path.join(dataDir, 'repo'),
    gitDir: '.git',
    commonGitDir: '.git',
  });
  await installManagedRuntime({ dataDir, identity, runner: { run: async () => undefined }, preflight: false });
  const receivedEnvironment: Array<NodeJS.ProcessEnv | undefined> = [];
  const controller: ProcessController = {
    async start(_command, _logFile, environment) {
      receivedEnvironment.push(environment);
      return { pid: 84, stop: async () => undefined };
    },
  };

  await startManagedRuntime(dataDir, identity, {
    agentMemoryMode: 'managed',
    agentMemoryEnvironment: {
      AGENTMEMORY_SECRET: 'managed-secret-value',
      AGENTMEMORY_TOOLS: 'core',
    },
    controller,
  });

  expect(receivedEnvironment).toEqual([{
    AGENTMEMORY_SECRET: 'managed-secret-value',
    AGENTMEMORY_TOOLS: 'core',
  }]);
  const layout = runtimeLayout(dataDir, identity);
  const serialized = [
    await readFile(path.join(layout.current, 'runtime-lock.json'), 'utf8'),
    await readFile(layout.stateFile, 'utf8'),
  ].join('\n');
  expect(serialized).not.toContain('managed-secret-value');
  expect(serialized).not.toContain('AGENTMEMORY_SECRET');
});

test('AC-034: start gerenciado só retorna após executar a verificação de readiness @spec:AC-034', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-managed-readiness-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({
    root: path.join(dataDir, 'repo'),
    gitDir: '.git',
    commonGitDir: '.git',
  });
  await installManagedRuntime({ dataDir, identity, runner: { run: async () => undefined }, preflight: false });
  let readinessChecks = 0;

  await startManagedRuntime(dataDir, identity, {
    controller: {
      async start() {
        return { pid: 85, stop: async () => undefined };
      },
    },
    ready: async () => {
      readinessChecks += 1;
    },
  });

  expect(readinessChecks).toBe(1);
});
