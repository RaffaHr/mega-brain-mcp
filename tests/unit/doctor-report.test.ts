import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS } from '../../src/runtime/dependency-versions.js';
import { formatDoctorReport, runDoctor, runDoctorFix } from '../../src/cli/doctor.js';
import { queuePendingDelete } from '../../src/runtime/pending-deletes.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, '');
}

test('doctor report renders a structured terminal table with checks', async () => {
  const response = await runDoctor({
    project: 'shop',
    hooksHealthy: true,
    queueDepth: 0,
    config: {
      dataDir: 'C:/data',
      port: 3000,
      logLevel: 'info',
      allowEgress: false,
      allowLlm: false,
      authToken: 'super-secret',
      agentMemory: { mode: 'managed', baseUrl: 'http://127.0.0.1:12000' },
      codeReviewGraph: { command: 'code-review-graph', dataDir: 'C:/crg' },
    },
  }, {
    inspect: async () => ({
      healthy: true,
      checks: { project: true, agentMemory: true, codeReviewGraph: true },
      manifest: {
        schemaVersion: 1,
        installedAt: '2026-08-24T12:00:00.000Z',
        project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
        versions: { megaBrain: '0.1.5', agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph },
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
      },
    }),
    probeAgentMemory: async () => ({ healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, endpoints: ['health'] }),
    probeCodeReviewGraph: async () => ({ healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph, graphHead: 'head', tools: ['query_graph_tool'] }),
    gitHead: async () => 'head',
  });

  const report = stripAnsi(formatDoctorReport(response));
  expect(report).toContain('Mega Brain doctor');
  expect(report).toContain('Health checks');
  expect(report).toContain('│ Runtime');
  expect(report).toContain('✓ Healthy');
  expect(report).toContain('No warnings detected');
  expect(report).not.toContain('super-secret');
  expect(report).not.toContain('{"schemaVersion"');
});

test('doctor report highlights degraded checks and warnings', async () => {
  const response = await runDoctor({ project: 'shop', hooksHealthy: false, queueDepth: 2 }, {
    inspect: async () => ({
      healthy: false,
      checks: { project: true, codeReviewGraph: false },
      manifest: {
        schemaVersion: 1,
        installedAt: '2026-08-24T12:00:00.000Z',
        project: { repositoryId: 'r', checkoutId: 'c', worktreeId: 'w' },
        versions: { megaBrain: '0.1.5', agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph },
        backends: {
          agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
          codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
        },
      },
    }),
    probeAgentMemory: async () => ({ healthy: false, version: null, endpoints: [] }),
    probeCodeReviewGraph: async () => ({ healthy: true, version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph, graphHead: 'old', tools: ['query_graph_tool'] }),
    gitHead: async () => 'new',
  });

  const report = stripAnsi(formatDoctorReport(response));
  expect(report).toContain('× Degraded');
  expect(report).toContain('× Unavailable');
  expect(report).toContain('× 2 pending');
  expect(report).toContain('× code_review_graph index is behind Git HEAD');
  expect(report).toContain('× hook installation is unhealthy');
});

test('runDoctorFix purges pending delete queues and sweeps runtime', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-doctor-fix-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const targetDir = path.join(dataDir, 'pending-folder');
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, 'temp.log'), 'test');

  await queuePendingDelete(dataDir, targetDir);
  const fixResult = await runDoctorFix({ dataDir, identity, layout });

  expect(fixResult.purged).toContain(path.resolve(targetDir));
});