import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS } from '../../src/runtime/dependency-versions.js';

import { loadConfig } from '../../src/config/load.js';
import { createAgentMemoryClient } from '../../src/cli/index.js';
import { runDoctor } from '../../src/cli/doctor.js';
import { installManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { startManagedRuntime } from '../../src/cli/start.js';
import { uninstallMegaBrain } from '../../src/cli/uninstall.js';
import { upgradeManagedRuntime } from '../../src/cli/upgrade.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import type { ProcessController } from '../../src/runtime/supervisor.js';

const noOpRunner: CommandRunner = { run: async () => undefined };

test('AC-016: status mostra saúde sem expor secrets @spec:AC-016', async () => {
  const response = await runDoctor({ project: 'shop', hooksHealthy: true, queueDepth: 0, config: {
    authToken: 'super-secret', nested: { Authorization: 'Bearer raw-token' },
  } }, {
    inspect: async () => ({ healthy: true, checks: { project: true }, manifest: {
      schemaVersion: 1, installedAt: '2026-08-24T12:00:00.000Z',
      project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
      versions: { megaBrain: '0.1.7', agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph },
      backends: {
        agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
        codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
      },
      isolation: {
        worktreeId: '0123456789abcdef01234567',
        ports: { rest: 12000, streams: 12001, viewer: 12002, engine: 58023 },
        paths: {
          agentMemory: path.resolve('runtime/agentmemory'),
          iiiEngine: path.resolve('runtime/iii'),
          codeReviewGraph: path.resolve('runtime/crg'),
          provenance: path.resolve('runtime/provenance.sqlite'),
        },
      },
    } }),
    probeAgentMemory: async () => ({ healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, endpoints: ['health'] }),
    probeCodeReviewGraph: async () => ({ healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph, graphHead: 'head', tools: ['query_graph_tool'] }),
    gitHead: async () => 'head',
  });
  expect(response.status).toBe('ok');
  expect(JSON.stringify(response)).not.toContain('super-secret');
  expect(JSON.stringify(response)).not.toContain('raw-token');
  expect(response.result).toMatchObject({ hooksHealthy: true, queueDepth: 0, graphHead: 'head' });
  expect(response.result).toMatchObject({ runtime: { isolation: {
    paths: { codeReviewGraph: path.resolve('runtime/crg') },
    ports: { rest: 12000, engine: 58023 },
  } } });
});

test('AC-022: doctor comprova o ciclo real dos backends @spec:AC-022', async () => {
  const calls: string[] = [];
  const response = await runDoctor({ project: 'shop', hooksHealthy: true, queueDepth: 0 }, {
    inspect: async () => { calls.push('runtime'); return {
      healthy: true, checks: { project: true, agentMemory: true, codeReviewGraph: true },
      manifest: {
        schemaVersion: 1, installedAt: '2026-08-24T12:00:00.000Z', project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
        versions: { megaBrain: '0.1.7', agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph },
        backends: {
          agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
          codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
        },
      },
    }; },
    probeAgentMemory: async () => { calls.push('rest-health-auth-schema'); return { healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, endpoints: ['health'] }; },
    probeCodeReviewGraph: async () => { calls.push('mcp-handshake-tools-schema'); return { healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph, graphHead: 'old', tools: ['query_graph_tool'] }; },
    gitHead: async () => { calls.push('git-head'); return 'new'; },
  });
  expect(calls.sort()).toEqual(['git-head', 'mcp-handshake-tools-schema', 'rest-health-auth-schema', 'runtime'].sort());
  expect(response.status).toBe('degraded');
  expect(response.freshness).toBe('POSSIBLY_STALE');
  expect(response.warnings).toContain('code_review_graph index is behind Git HEAD');
});

test('AC-023: upgrade e uninstall são reversíveis @spec:AC-023', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-lifecycle-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  await installManagedRuntime({ dataDir, identity, runner: noOpRunner, preflight: false, now: new Date('2026-08-24T10:00:00.000Z') });
  const layout = runtimeLayout(dataDir, identity);
  await writeFile(path.join(layout.current, 'sentinel.txt'), 'previous-runtime', 'utf8');
  await expect(upgradeManagedRuntime({
    dataDir, identity, runner: noOpRunner, preflight: false, now: new Date('2026-08-24T11:00:00.000Z'),
    validate: async () => { throw new Error('failed post-upgrade validation'); },
  })).rejects.toThrow('failed post-upgrade validation');
  expect(await readFile(path.join(layout.current, 'sentinel.txt'), 'utf8')).toBe('previous-runtime');

  const dataFile = path.join(layout.projectRoot, 'agentmemory-data', 'memory.db');
  await writeFile(dataFile, 'preserve-me', { encoding: 'utf8', flag: 'w' }).catch(async () => {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(dataFile), { recursive: true }));
    await writeFile(dataFile, 'preserve-me', 'utf8');
  });
  const rollback = vi.fn(async () => undefined);
  await expect(uninstallMegaBrain({ dataDir, identity, participants: [
    { apply: async () => undefined, rollback },
    { apply: async () => { throw new Error('hook restoration failed'); }, rollback: async () => undefined },
  ] })).rejects.toThrow('hook restoration failed');
  expect(rollback).toHaveBeenCalledOnce();
  expect(await access(layout.current).then(() => true).catch(() => false)).toBe(true);

  expect(await uninstallMegaBrain({ dataDir, identity })).toEqual({ dataPreserved: true });
  expect(await readFile(dataFile, 'utf8')).toBe('preserve-me');
});

test('AC-028: opt-ins encaminham credencial apenas à autenticação REST e nunca à configuração serializada @spec:AC-028 @principle:P-002', async () => {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const config = await loadConfig({
    envFilePath: false,
    env: {
      MEGA_BRAIN_ALLOW_EGRESS: 'true',
      MEGA_BRAIN_ALLOW_LLM: 'true',
      AGENTMEMORY_SECRET: 'runtime-only-secret',
      ANTHROPIC_API_KEY: 'runtime-only-provider-key',
    },
  });

  const client = createAgentMemoryClient(config, fetch);
  await client.livez();

  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-opt-in-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  await installManagedRuntime({ dataDir, identity, runner: noOpRunner, preflight: false });
  const spawnedEnvironments: Array<NodeJS.ProcessEnv | undefined> = [];
  const controller: ProcessController = {
    async start(_command, _logFile, environment) {
      spawnedEnvironments.push(environment);
      return { pid: 126, stop: async () => undefined };
    },
  };
  await startManagedRuntime(dataDir, identity, {
    agentMemoryMode: config.agentMemory.mode,
    agentMemoryEnvironment: config.agentMemory.environment,
    controller,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.get('authorization')).toBe('Bearer runtime-only-secret');
  expect(spawnedEnvironments).toEqual([expect.objectContaining({
    AGENTMEMORY_SECRET: 'runtime-only-secret',
    ANTHROPIC_API_KEY: 'runtime-only-provider-key',
  })]);
  const layout = runtimeLayout(dataDir, identity);
  const serializedRuntime = [
    await readFile(path.join(layout.current, 'runtime-lock.json'), 'utf8'),
    await readFile(layout.stateFile, 'utf8'),
  ].join('\n');
  expect(serializedRuntime).not.toContain('runtime-only-secret');
  expect(serializedRuntime).not.toContain('runtime-only-provider-key');
  expect(serializedRuntime).not.toContain('ANTHROPIC_API_KEY');
});
