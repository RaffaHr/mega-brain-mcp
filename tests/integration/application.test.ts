import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import type { AgentMemoryClient } from '../../src/adapters/agentmemory/client.js';
import type { CodeReviewGraphClient } from '../../src/adapters/code-review-graph/client.js';
import type { GitRepository } from '../../src/adapters/git/repository.js';
import type { MegaBrainConfig } from '../../src/config/schema.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { openProvenanceDatabase } from '../../src/provenance/database.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';
import { createApplicationHandlers } from '../../src/server/application.js';
import { PUBLIC_TOOL_NAMES } from '../../src/server/index.js';

test('composition root conecta as seis tools a handlers operacionais', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-app-'));
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const database = openProvenanceDatabase(':memory:');
  const config = {
    dataDir, logLevel: 'info', allowEgress: false, allowLlm: false,
    agentMemory: { baseUrl: 'http://127.0.0.1:3111', environment: {} },
    codeReviewGraph: { command: 'crg', args: [], environment: {} }, projects: {},
  } satisfies MegaBrainConfig;
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
