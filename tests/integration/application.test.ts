import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import type { AgentMemoryClient } from '../../src/adapters/agentmemory/client.js';
import type { CodeReviewGraphClient } from '../../src/adapters/code-review-graph/client.js';
import { NO_GIT_HEAD, type GitRepository } from '../../src/adapters/git/repository.js';
import type { MegaBrainConfig } from '../../src/config/schema.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { openProvenanceDatabase } from '../../src/provenance/database.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';
import { createApplicationHandlers } from '../../src/server/application.js';
import { PUBLIC_TOOL_NAMES } from '../../src/server/index.js';

function testConfig(dataDir: string): MegaBrainConfig {
  return {
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
    codeReviewGraph: { command: 'crg', args: [], environment: {} },
    projects: {},
  };
}

test('composition root conecta as seis tools a handlers operacionais', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-app-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const database = openProvenanceDatabase(':memory:');
  const config = testConfig(dataDir);
  const agentMemory = {
    health: async () => ({ healthy: true, version: '0.9.29' }),
    smartSearch: async () => ({ results: [] }),
  } as unknown as AgentMemoryClient;
  const crgCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const codeReviewGraph = {
    start: async () => undefined,
    call: async (name: string, input: Record<string, unknown>) => {
      crgCalls.push({ name, input });
      return { content: [], structuredContent: { graphHead: 'abc' } };
    },
    serverVersion: () => '2.3.7',
  } as unknown as CodeReviewGraphClient;
  const git = { head: async () => 'abc' } as unknown as GitRepository;
  const handlers = createApplicationHandlers({
    config, identity, git, agentMemory, codeReviewGraph, provenance: new ProvenanceRepository(database),
  });
  expect(Object.keys(handlers).sort()).toEqual([...PUBLIC_TOOL_NAMES].sort());
  const status = await handlers.brain_status!({});
  expect(status.status).toBe('ok');
  expect(status.result).not.toMatchObject({ available: false });
  await handlers.brain_change_context!({ target: 'src/example.ts' });
  expect(crgCalls).toEqual(expect.arrayContaining([
    { name: 'get_impact_radius_tool', input: { changed_files: ['src/example.ts'] } },
    { name: 'get_affected_flows_tool', input: { changed_files: ['src/example.ts'] } },
    { name: 'query_graph_tool', input: { pattern: 'file_summary', target: 'src/example.ts' } },
  ]));
  database.close();
});

test('AC-057: handlers operam status sem exigir Git ate uma tool precisar dele @spec:AC-057', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-app-non-git-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.mega-brain/non-git-project', commonGitDir: '.mega-brain/non-git-project', gitBacked: false });
  const database = openProvenanceDatabase(':memory:');
  const agentMemory = {
    health: async () => ({ healthy: true, version: '0.9.29' }),
    smartSearch: async () => ({ results: [] }),
  } as unknown as AgentMemoryClient;
  const codeReviewGraph = {
    start: async () => undefined,
    call: async () => ({ content: [], structuredContent: {} }),
    serverVersion: () => '2.3.7',
  } as unknown as CodeReviewGraphClient;

  const handlers = createApplicationHandlers({
    config: testConfig(dataDir),
    identity,
    git: null,
    agentMemory,
    codeReviewGraph,
    provenance: new ProvenanceRepository(database),
  });
  const status = await handlers.brain_status!({});

  expect(status.head).toBe('NO_GIT');
  expect(status.status).toBe('degraded');
  expect(status.warnings).toEqual(expect.arrayContaining(['git repository unavailable', 'hook installation is unhealthy']));
  database.close();
});

test('handlers degradam quando Git existe mas ainda nao tem HEAD', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-app-unborn-git-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const database = openProvenanceDatabase(':memory:');
  const agentMemory = {
    health: async () => ({ healthy: true, version: '0.9.29' }),
    smartSearch: async () => ({ results: [] }),
  } as unknown as AgentMemoryClient;
  const codeReviewGraph = {
    start: async () => undefined,
    call: async () => ({ content: [], structuredContent: { graphHead: 'abc' } }),
    serverVersion: () => '2.3.7',
  } as unknown as CodeReviewGraphClient;
  const git = { head: async () => NO_GIT_HEAD } as unknown as GitRepository;
  const handlers = createApplicationHandlers({
    config: testConfig(dataDir),
    identity,
    git,
    agentMemory,
    codeReviewGraph,
    provenance: new ProvenanceRepository(database),
  });
  const status = await handlers.brain_status!({});

  expect(status.head).toBe(NO_GIT_HEAD);
  expect(status.status).toBe('degraded');
  expect(status.warnings).toContain('git repository unavailable');
  expect(status.warnings).not.toContain('code_review_graph index is behind Git HEAD');
  database.close();
});
