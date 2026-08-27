import { describe, expect, test, vi } from 'vitest';

import type { EvidenceChunk } from '../../src/orchestration/ranking.js';
import { brainRecall, type RecallSourceAdapter } from '../../src/tools/brain-recall.js';

function chunk(source: EvidenceChunk['source'], id: string, text = 'evidence text'): EvidenceChunk {
  return {
    id,
    source,
    text,
    retrieval: 1,
    intentFit: 1,
    freshness: 1,
    confidence: 1,
    provenance: 1,
    reinforcement: 1,
    reference: `${source}:${id}`,
  };
}

describe('brainRecall parallel source querying and error isolation', () => {
  test('AC-067: fontes consultadas em paralelo com isolamento de falhas @spec:AC-067', async () => {
    let orderResolve = 0;
    const resolvedOrder: string[] = [];

    const slowAdapter: RecallSourceAdapter = {
      recall: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        resolvedOrder.push('slow-crg');
        return [chunk('code_review_graph', 'crg-1')];
      }),
    };

    const fastAdapter: RecallSourceAdapter = {
      recall: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resolvedOrder.push('fast-memory');
        return [chunk('agentmemory', 'mem-1')];
      }),
    };

    const failingAdapter: RecallSourceAdapter = {
      recall: vi.fn(async () => {
        throw new Error('Git repository locked or corrupted');
      }),
    };

    const result = await brainRecall(
      { query: 'Why did login fail?', intent: 'debugging' },
      {
        sources: {
          code_review_graph: slowAdapter,
          agentmemory: fastAdapter,
          git: failingAdapter,
        },
        project: 'test-project',
        head: 'commit-123',
      },
    );

    // Verify fast finished before slow (proving parallel execution)
    expect(resolvedOrder).toEqual(['fast-memory', 'slow-crg']);

    // Verify failing source was isolated without crashing the entire recall
    expect(result.status).toBe('degraded');
    expect(result.warnings).toContain('git unavailable');

    // Verify context contains results from surviving sources
    expect(result.result.context).toContain('[agentmemory]');
    expect(result.result.context).toContain('[code_review_graph]');
  });
});
