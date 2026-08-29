import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { installManagedRuntime, inspectManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { startManagedRuntime } from '../../src/cli/start.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS, type ManagedDependencyVersions } from '../../src/runtime/dependency-versions.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import type { ProcessController } from '../../src/runtime/supervisor.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('AC-059: instalação emite logs informativos para cada etapa relevante @spec:AC-059', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-logs-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const logs: string[] = [];

  await installManagedRuntime({
    dataDir,
    identity,
    runner: { run: async () => undefined },
    preflight: false,
    validateArtifacts: false,
    logger: { log: (_level, message) => { logs.push(message); } },
  });

  expect(logs).toEqual(expect.arrayContaining([
    'install: checking prerequisites',
    'install: preparing isolated runtime directories',
    'install: installing AgentMemory packages',
    'install: creating Code Review Graph virtualenv',
    'install: installing Code Review Graph package',
    'install: building Code Review Graph index',
    'install: activating staged runtime',
    'install: runtime installation complete',
  ]));
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
  expect(commands[0]?.args).toContain(`@agentmemory/agentmemory@${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory}`);
  expect(commands[2]?.args).toContain(`code-review-graph[embeddings]==${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph}`);
  expect(commands[3]?.args).toEqual(['-m', 'code_review_graph', 'build']);
  expect(commands[3]?.options.env).toMatchObject({ CRG_REPO_ROOT: path.resolve(identity.root) });
  expect(path.isAbsolute(commands[3]?.options.env?.CRG_DATA_DIR ?? '')).toBe(true);
  expect(commands[3]?.options.env?.CRG_DATA_DIR).toContain(path.join('runtime', '.staging-'));
  expect(manifest.backends.codeReviewGraph.environment?.CRG_DATA_DIR).toBe(manifest.isolation!.paths.codeReviewGraph);
  expect(manifest.versions).toEqual({
    megaBrain: '0.1.6',
    agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory,
    codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph,
  });
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
  expect(manifest.backends.agentMemory?.environment).toEqual({
    AGENTMEMORY_III_CONFIG: path.join(manifest.backends.agentMemory!.cwd, 'iii-config.yaml'),
    AGENTMEMORY_III_VERSION: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.iiiEngine,
    HOME: manifest.isolation!.paths.iiiEngine,
    III_ENGINE_PORT: String(manifest.isolation!.ports.engine),
    III_ENGINE_URL: `ws://127.0.0.1:${manifest.isolation!.ports.engine}`,
    III_REST_PORT: String(manifest.isolation!.ports.rest),
    III_STREAM_PORT: String(manifest.isolation!.ports.streams),
    III_VIEWER_PORT: String(manifest.isolation!.ports.viewer),
    USERPROFILE: manifest.isolation!.paths.iiiEngine,
  });
  const iiiConfig = await readFile(manifest.backends.agentMemory!.environment!.AGENTMEMORY_III_CONFIG!, 'utf8');
  expect(iiiConfig).toContain(`port: ${manifest.isolation!.ports.rest}`);
  expect(iiiConfig).toContain(`port: ${manifest.isolation!.ports.streams}`);
  expect(iiiConfig).toContain('name: iii-worker-manager');
  expect(iiiConfig).toContain(`port: ${manifest.isolation!.ports.engine}`);
});

test('versoes gerenciadas customizadas controlam download e manifesto do runtime', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-versions-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const versions: ManagedDependencyVersions = {
    agentMemory: '0.9.30',
    codeReviewGraph: '2.4.1',
    iiiEngine: '0.11.4',
  };
  const commands: Array<{ command: string; args: string[] }> = [];

  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    runner: { async run(command, args) { commands.push({ command, args }); } },
    preflight: false,
    now: new Date('2026-08-24T12:00:00.000Z'),
    dependencyVersions: versions,
  });

  expect(commands[0]?.args).toContain(`@agentmemory/agentmemory@${versions.agentMemory}`);
  expect(commands[2]?.args).toContain(`code-review-graph[embeddings]==${versions.codeReviewGraph}`);
  expect(manifest.versions).toEqual({ megaBrain: '0.1.6', agentMemory: versions.agentMemory, codeReviewGraph: versions.codeReviewGraph });
  expect(manifest.backends.agentMemory?.environment?.AGENTMEMORY_III_VERSION).toBe(versions.iiiEngine);
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
    remoteAgentMemory: { baseUrl: 'https://memory.example.test' },
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
  expect(commands.flatMap(({ args }) => args)).not.toContain(`@agentmemory/agentmemory@${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory}`);
  expect(commands[1]?.args).toContain(`code-review-graph[embeddings]==${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph}`);
  expect(manifest.agentMemoryMode).toBe('remote');
  expect(manifest.backends).not.toHaveProperty('agentMemory');
  expect(inspection.checks).toEqual({ project: true, isolation: true, codeReviewGraph: true });
  expect(manifest.remoteAgentMemory).toEqual({
    baseUrl: 'https://memory.example.test',
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

  expect(receivedEnvironment).toHaveLength(1);
  expect(receivedEnvironment[0]).toMatchObject({
    AGENTMEMORY_SECRET: 'managed-secret-value',
    AGENTMEMORY_TOOLS: 'core',
  });
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

test('AC-043: CRG customizado é validado e persistido sem instalar o pacote gerenciado @spec:AC-043', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-custom-crg-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const commands: Array<{ command: string; args: string[] }> = [];
  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    preflight: false,
    runner: { async run(command, args) { commands.push({ command, args }); } },
    codeReviewGraph: { mode: 'custom', command: 'custom-crg', args: ['--profile', 'isolated'] },
  });

  expect(commands.flatMap(({ args }) => args)).not.toContain(`code-review-graph[embeddings]==${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph}`);
  expect(commands).toContainEqual({ command: 'custom-crg', args: ['--profile', 'isolated', 'build'] });
  expect(manifest.backends.codeReviewGraph).toMatchObject({
    command: 'custom-crg',
    args: ['--profile', 'isolated', 'serve'],
  });
});