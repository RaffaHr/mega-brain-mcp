import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test, vi } from 'vitest';

import { installHostMcpFiles } from '../../src/cli/host-integration.js';
import { installHostHookFiles } from '../../src/cli/host-hooks.js';
import { installProjectTransaction } from '../../src/cli/install.js';
import { runtimeSwapLifecycle } from '../../src/cli/index.js';
import { drainProjectSupervisor, uninstallMegaBrain } from '../../src/cli/uninstall.js';
import { GitRepository } from '../../src/adapters/git/repository.js';
import { installGitHookMultiplexer } from '../../src/hooks/git/install.js';
import type { MegaBrainConfig } from '../../src/config/schema.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { startProjectSupervisor } from '../../src/runtime/project-supervisor.js';
import { retryFilesystemOperation, RuntimeTransaction, stripReadOnlyAttributes } from '../../src/runtime/transaction.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('AC-054: falha pós-staging restaura runtime, iii-engine, grafo e hosts byte a byte @spec:AC-054', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-install-transaction-'));
  temporaryDirectories.push(root);
  const repository = path.join(root, 'repository');
  const dataDir = path.join(root, 'data');
  await mkdir(path.join(repository, '.codex'), { recursive: true });
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', ['-C', repository, 'config', '--local', 'core.hooksPath', '.existing-hooks']);
  const gitRepository = await GitRepository.discover(repository);
  const identity = deriveProjectIdentity({ root: repository, gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const oldRuntime = Buffer.from('previous-runtime\n');
  const oldEngine = Buffer.from('previous-iii-engine');
  const oldGraph = Buffer.from('previous-graph\n');
  const codexOriginal = Buffer.from('[mcp_servers.existing]\nurl = "http://example.test/mcp"\n');
  const hooksOriginal = Buffer.from('{\n  "custom": true,\n  "hooks": {}\n}\n');
  await mkdir(layout.current, { recursive: true });
  await mkdir(path.join(layout.projectRoot, 'iii-engine'), { recursive: true });
  await mkdir(path.join(layout.projectRoot, 'code-review-graph-data'), { recursive: true });
  await writeFile(path.join(layout.current, 'previous.txt'), oldRuntime);
  await writeFile(path.join(layout.projectRoot, 'iii-engine', 'iii.exe'), oldEngine);
  await writeFile(path.join(layout.projectRoot, 'code-review-graph-data', 'graph.db'), oldGraph);
  await writeFile(path.join(repository, '.codex', 'config.toml'), codexOriginal);
  await writeFile(path.join(repository, '.codex', 'hooks.json'), hooksOriginal);
  const nextEngine = Buffer.from('new-iii-engine');

  await expect(installProjectTransaction({
    dataDir,
    identity,
    preflight: false,
    platform: 'win32',
    validateArtifacts: false,
    runner: { run: async () => undefined },
    iiiEngine: {
      confirmed: true,
      expectedSha256: createHash('sha256').update(nextEngine).digest('hex'),
      download: async () => nextEngine,
    },
    async configure(transaction) {
      const backupDir = path.join(layout.projectRoot, 'integration-backups');
      await installHostMcpFiles({
        root: repository,
        backupDir,
        hosts: ['codex', 'claude'],
        connection: { transport: 'stdio', command: 'mega-brain', args: ['mcp', '--repo', repository] },
        transaction,
      });
      await installHostHookFiles({ root: repository, backupDir, hosts: ['codex', 'claude'], transaction });
      await installGitHookMultiplexer({
        repository: gitRepository,
        managedHooksPath: path.join(layout.projectRoot, 'hooks', 'git'),
        megaBrainCommand: ['mega-brain'],
        transaction,
      });
      throw new Error('injected post-staging failure');
    },
  })).rejects.toThrow('injected post-staging failure');

  expect(await readFile(path.join(layout.current, 'previous.txt'))).toEqual(oldRuntime);
  expect(await readFile(path.join(layout.projectRoot, 'iii-engine', 'iii.exe'))).toEqual(oldEngine);
  expect(await readFile(path.join(layout.projectRoot, 'code-review-graph-data', 'graph.db'))).toEqual(oldGraph);
  expect(await readFile(path.join(repository, '.codex', 'config.toml'))).toEqual(codexOriginal);
  expect(await readFile(path.join(repository, '.codex', 'hooks.json'))).toEqual(hooksOriginal);
  await expect(readFile(path.join(repository, '.mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(repository, '.claude', 'settings.local.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await gitRepository.run(['config', '--local', '--get', 'core.hooksPath'])).trim()).toBe('.existing-hooks');
  await expect(readdir(path.join(layout.projectRoot, 'hooks', 'git'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readdir(layout.runtimeRoot)).filter((name) => /staging|backup/u.test(name))).toEqual([]);
});

test('AC-054: rollback encerra runtime novo e reativa o anterior depois de restaurar os bytes @spec:AC-054', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-active-runtime-transaction-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  await mkdir(layout.current, { recursive: true });
  await writeFile(path.join(layout.current, 'previous.txt'), 'old');
  const lifecycle: string[] = [];

  await expect(installProjectTransaction({
    dataDir,
    identity,
    preflight: false,
    validateArtifacts: false,
    runner: { run: async () => undefined },
    async beforeSwap(transaction) {
      lifecycle.push('stop-previous');
      transaction.addRollback(async () => { lifecycle.push('restart-previous'); });
    },
    async afterSwap(transaction) {
      transaction.addRollback(async () => { lifecycle.push('stop-next'); });
      lifecycle.push('start-next');
    },
    async configure() { throw new Error('integration failed'); },
  })).rejects.toThrow('integration failed');

  expect(lifecycle).toEqual(['stop-previous', 'start-next', 'stop-next', 'restart-previous']);
  expect(await readFile(path.join(layout.current, 'previous.txt'), 'utf8')).toBe('old');
});

test('AC-054: uninstall drena antes de mutar e retoma runtime anterior quando a transação falha @spec:AC-054', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-uninstall-transaction-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  await mkdir(layout.current, { recursive: true });
  await writeFile(path.join(layout.current, 'runtime-lock.json'), '{}');
  const order: string[] = [];
  const resume = vi.fn(async () => { order.push('resume'); });

  await expect(uninstallMegaBrain({
    dataDir,
    identity,
    drain: async () => { order.push('drain'); },
    resume,
    participants: [{
      async apply() { order.push('participant'); throw new Error('host restore failed'); },
      async rollback() { order.push('participant-rollback'); },
    }],
  })).rejects.toThrow('host restore failed');

  expect(order).toEqual(['drain', 'participant', 'participant-rollback', 'resume']);
  expect(resume).toHaveBeenCalledOnce();
  expect(await readFile(path.join(layout.current, 'runtime-lock.json'), 'utf8')).toBe('{}');
});

test('AC-054: drain coordenado encerra supervisor e backends antes do uninstall @spec:AC-054', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-uninstall-drain-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const server = await startProjectSupervisor({ layout, identity, pid: 4545 });
  const stopped: string[] = [];

  await drainProjectSupervisor({
    dataDir,
    identity,
    stopProcess: async (pid) => { stopped.push(`supervisor:${pid}`); await server.close(); },
    stopRuntime: async () => { stopped.push('backends'); },
  });

  expect(stopped).toEqual(['supervisor:4545', 'backends']);
});

test('AC-061: retry de filesystem tolera EPERM transitorio no Windows @spec:AC-061', async () => {
  let attempts = 0;
  await retryFilesystemOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
  }, 'Retrying locked runtime rename', { platform: 'win32', timeoutMs: 1_000, intervalMs: 1 });

  expect(attempts).toBe(3);
});

test('runtime cleanup preserves executable bits', async () => {
  if (process.platform === 'win32') return;
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-permissions-'));
  temporaryDirectories.push(root);
  const executable = path.join(root, 'runtime-bin');
  await writeFile(executable, '#!/bin/sh\n', 'utf8');
  await chmod(executable, 0o755);

  await stripReadOnlyAttributes(root);

  expect((await stat(executable)).mode & 0o111).toBe(0o111);
});

test('AC-060: install drena runtime existente sem state e nao reinicia se nao estava ativo @spec:AC-060', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-installed-runtime-swap-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const config: MegaBrainConfig = {
    dataDir,
    port: 3000,
    logLevel: 'info',
    allowEgress: false,
    allowLlm: false,
    agentMemory: {
      mode: 'managed',
      baseUrl: 'http://127.0.0.1:3111',
      ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
      environment: {},
    },
    codeReviewGraph: {
      command: 'code-review-graph',
      args: [],
      environment: {},
    },
    projects: {},
  };
  const transaction = new RuntimeTransaction();
  const lifecycle: string[] = [];

  const swap = runtimeSwapLifecycle(config, identity, {
    runtimeWasActive: false,
    drain: async () => { lifecycle.push('drain-existing-runtime'); },
    stop: async () => { lifecycle.push('stop'); },
    start: async () => { lifecycle.push('start'); },
  });

  await swap.beforeSwap?.(transaction);
  await swap.afterSwap?.(transaction, {} as never);
  await transaction.commit();

  expect(lifecycle).toEqual(['drain-existing-runtime']);
});

test('AC-045: uninstall preserva dados por default e só remove o namespace com purge explícito @spec:AC-045', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-uninstall-purge-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const memory = path.join(layout.projectRoot, 'agentmemory-data', 'memory.db');
  await mkdir(layout.current, { recursive: true });
  await mkdir(path.dirname(memory), { recursive: true });
  await writeFile(path.join(layout.current, 'runtime-lock.json'), '{}');
  await writeFile(memory, 'preserve-me');

  expect(await uninstallMegaBrain({ dataDir, identity, drain: async () => undefined })).toEqual({ dataPreserved: true });
  expect(await readFile(memory, 'utf8')).toBe('preserve-me');
  expect(await uninstallMegaBrain({ dataDir, identity, drain: async () => undefined, purge: true })).toEqual({ dataPreserved: false });
  await expect(readFile(memory, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});


test('AC-062: uninstall succeeds and cleans project data even when workspace config is missing @spec:AC-062', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-uninstall-missing-config-'));
  temporaryDirectories.push(dataDir);
  const repo = path.join(dataDir, 'repo');
  const identity = deriveProjectIdentity({ root: repo, gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  await mkdir(layout.current, { recursive: true });
  await writeFile(path.join(layout.current, 'runtime-lock.json'), '{}');

  // No .mega-brain/config.json exists in workspace
  const result = await uninstallMegaBrain({ dataDir, identity, drain: async () => undefined, purge: true });
  expect(result.dataPreserved).toBe(false);
  await expect(readdir(layout.projectRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});
