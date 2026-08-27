import { describe, expect, test, vi } from 'vitest';

import { LocalMetrics } from '../../src/observability/metrics.js';
import type { EvidenceChunk } from '../../src/orchestration/ranking.js';
import { brainRecall, type RecallSourceAdapter } from '../../src/tools/brain-recall.js';

function chunk(source: EvidenceChunk['source'], id: string, text = 'evidence'): EvidenceChunk {
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

describe('recall metrics instrumentation', () => {
  test('AC-068: latência por fonte e contagem de chunks registrados em metrics @spec:AC-068', async () => {
    const metrics = new LocalMetrics();

    const memAdapter: RecallSourceAdapter = {
      recall: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return [
          chunk('agentmemory', 'm1', 'large rule text '.repeat(50)),
          chunk('agentmemory', 'm2', 'large bug text '.repeat(50)),
          chunk('agentmemory', 'm3', 'large decision text '.repeat(50)),
        ];
      }),
    };

    const crgAdapter: RecallSourceAdapter = {
      recall: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [chunk('code_review_graph', 'c1', 'dependency context')];
      }),
    };

    await brainRecall(
      { query: 'test query', budget: 'FAST' },
      {
        sources: {
          agentmemory: memAdapter,
          code_review_graph: crgAdapter,
        },
        project: 'test-project',
        head: 'commit-123',
        maxTokenBudget: 200,
        metrics,
      },
    );

    const snapshot = metrics.snapshot();

    // Verify latency gauges recorded per source
    expect(snapshot.gauges['recall_latency_agentmemory']).toBeGreaterThanOrEqual(10);
    expect(snapshot.gauges['recall_latency_code_review_graph']).toBeGreaterThanOrEqual(0);

    // Verify chunks total and dropped counters
    expect(snapshot.counters['chunks_total']).toBe(4);
    expect(snapshot.counters['chunks_included']).toBeGreaterThan(0);
    expect(snapshot.counters['chunks_dropped']).toBeGreaterThan(0);
    expect(snapshot.counters['chunks_included'] + snapshot.counters['chunks_dropped']).toBe(4);
  });
});
