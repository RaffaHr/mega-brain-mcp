import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

import { runDoctor } from '../../src/cli/doctor.js';
import { installManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { uninstallMegaBrain } from '../../src/cli/uninstall.js';
import { upgradeManagedRuntime } from '../../src/cli/upgrade.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';

const noOpRunner: CommandRunner = { run: async () => undefined };

test('AC-016: status mostra saúde sem expor secrets @spec:AC-016', async () => {
  const response = await runDoctor({ project: 'shop', hooksHealthy: true, queueDepth: 0, config: {
    authToken: 'super-secret', nested: { Authorization: 'Bearer raw-token' },
  } }, {
    inspect: async () => ({ healthy: true, checks: { project: true }, manifest: {
      schemaVersion: 1, installedAt: '2026-08-24T12:00:00.000Z',
      project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
      versions: { megaBrain: '0.1.0', agentMemory: '0.9.29', codeReviewGraph: '2.3.7' },
      backends: {
        agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
        codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
      },
    } }),
    probeAgentMemory: async () => ({ healthy: true, version: '0.9.29', endpoints: ['health'] }),
    probeCodeReviewGraph: async () => ({ healthy: true, version: '2.3.7', graphHead: 'head', tools: ['query_graph_tool'] }),
    gitHead: async () => 'head',
  });
  expect(response.status).toBe('ok');
  expect(JSON.stringify(response)).not.toContain('super-secret');
  expect(JSON.stringify(response)).not.toContain('raw-token');
  expect(response.result).toMatchObject({ hooksHealthy: true, queueDepth: 0, graphHead: 'head' });
});

test('AC-022: doctor comprova o ciclo real dos backends @spec:AC-022', async () => {
  const calls: string[] = [];
  const response = await runDoctor({ project: 'shop', hooksHealthy: true, queueDepth: 0 }, {
    inspect: async () => { calls.push('runtime'); return {
      healthy: true, checks: { project: true, agentMemory: true, codeReviewGraph: true },
      manifest: {
        schemaVersion: 1, installedAt: '2026-08-24T12:00:00.000Z', project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
        versions: { megaBrain: '0.1.0', agentMemory: '0.9.29', codeReviewGraph: '2.3.7' },
        backends: {
          agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
          codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
        },
      },
    }; },
    probeAgentMemory: async () => { calls.push('rest-health-auth-schema'); return { healthy: true, version: '0.9.29', endpoints: ['health'] }; },
    probeCodeReviewGraph: async () => { calls.push('mcp-handshake-tools-schema'); return { healthy: true, version: '2.3.7', graphHead: 'old', tools: ['query_graph_tool'] }; },
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
  await installManagedRuntime({ dataDir, identity, runner: noOpRunner, now: new Date('2026-08-24T10:00:00.000Z') });
  const layout = runtimeLayout(dataDir, identity);
  await writeFile(path.join(layout.current, 'sentinel.txt'), 'previous-runtime', 'utf8');
  await expect(upgradeManagedRuntime({
    dataDir, identity, runner: noOpRunner, now: new Date('2026-08-24T11:00:00.000Z'),
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
