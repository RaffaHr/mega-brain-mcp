import { expect, test, vi } from 'vitest';

import type { EvidenceChunk } from '../../src/orchestration/ranking.js';
import { brainRecall, type RecallSourceAdapter } from '../../src/tools/brain-recall.js';

function chunk(source: EvidenceChunk['source'], text = 'current evidence'): EvidenceChunk {
  return { id: source, source, text, retrieval: 1, intentFit: 1, freshness: 1, confidence: 1, provenance: 1, reinforcement: 1, reference: `${source}:1` };
}

function source(name: EvidenceChunk['source'], calls: string[]): RecallSourceAdapter {
  return { recall: vi.fn(async () => { calls.push(name); return [chunk(name)]; }) };
}

test('AC-004: recall escolhe fontes conforme a intenção @spec:AC-004', async () => {
  const calls: string[] = [];
  const sources = {
    agentmemory: source('agentmemory', calls),
    code_review_graph: source('code_review_graph', calls),
    git: source('git', calls),
  };
  await brainRecall({ query: 'What breaks if I change login?', intent: 'impact' }, { sources, project: 'shop', head: 'abc' });
  expect(calls).toEqual(['code_review_graph', 'git', 'agentmemory']);
  calls.length = 0;
  await brainRecall({ query: 'Why did we choose JWT?', intent: 'decision' }, { sources, project: 'shop', head: 'abc' });
  expect(calls).toEqual(['agentmemory', 'git', 'code_review_graph']);
});

test('AC-005: recall respeita orçamento e contrato de resposta @spec:AC-005', async () => {
  const large: RecallSourceAdapter = { recall: async () => [chunk('git', 'x'.repeat(10_000))] };
  const result = await brainRecall({ query: 'implementation', budget: 'FAST' }, {
    sources: { git: large }, project: 'shop', head: 'abc', maxTokenBudget: 400,
  });
  expect(result.schemaVersion).toBe('1.0');
  expect(result.result.estimatedTokens).toBeLessThanOrEqual(400);
  expect(result.result.budget).toBe(400);
});

test('AC-006: recall degrada sem esconder indisponibilidade @spec:AC-006', async () => {
  const result = await brainRecall({ query: 'debug login', intent: 'debugging' }, {
    sources: { git: { recall: async () => [chunk('git')] } }, project: 'shop', head: 'abc',
  });
  expect(result.status).toBe('degraded');
  expect(result.warnings).toEqual(expect.arrayContaining(['agentmemory unavailable', 'code_review_graph unavailable']));
  expect(result.sources).toEqual([{ kind: 'git', reference: 'git', authority: 1 }]);
});
