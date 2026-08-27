// Testes de spec da feature p3-context-engine-auto-learning
import { describe, expect, it } from 'vitest';
import { extractLearningFromCommit } from '../src/lifecycle/commit-handler.js';
import { promoteCandidateMemories } from '../src/learning/promotion.js';
import { brainStatus } from '../src/tools/brain-status.js';

describe('p3-context-engine-auto-learning', () => {
  // US-032 — Extração e autoaprendizado a partir de commits estruturados
  it('AC-082: Extração automática de decisões e correções em hooks de commit @spec:AC-082', () => {
    const commit = {
      hash: 'a1b2c3d4e5f67890123456789012345678901234',
      subject: 'fix(auth): prevent token leak in response payload',
      files: ['src/auth/token.ts'],
    };

    const extracted = extractLearningFromCommit(commit);
    expect(extracted).not.toBeNull();
    expect(extracted.type).toBe('bug');
    expect(extracted.statement).toBe('[auth] prevent token leak in response payload');
    expect(extracted.commitHash).toBe(commit.hash);
    expect(extracted.files).toContain('src/auth/token.ts');

    const featCommit = {
      hash: 'f1e2d3c4b5a67890123456789012345678901234',
      subject: 'feat(billing): migrate to stripe v2',
      files: ['src/billing/stripe.ts'],
    };

    const featExtracted = extractLearningFromCommit(featCommit);
    expect(featExtracted.type).toBe('decision');
    expect(featExtracted.statement).toBe('[billing] migrate to stripe v2');
  });

  // US-032 — Extração e autoaprendizado a partir de commits estruturados
  it('AC-083: Promoção automática de memórias candidatas via execuções de testes bem-sucedidas @spec:AC-083', async () => {
    const updatedStates = [];
    const mockProvenance = {
      findCandidateMemories(filter) {
        if (filter?.commitHash === 'commit_123') {
          return [{ memoryId: 'mem_cand_1' }, { memoryId: 'mem_cand_2' }];
        }
        return [];
      },
      updateState(memoryId, state, confidence, reason) {
        updatedStates.push({ memoryId, state, confidence, reason });
      },
    };

    const result = await promoteCandidateMemories(mockProvenance, { commitHash: 'commit_123' });

    expect(result.promotedMemoryIds).toEqual(['mem_cand_1', 'mem_cand_2']);
    expect(updatedStates).toEqual([
      { memoryId: 'mem_cand_1', state: 'ACTIVE', confidence: 1.0, reason: 'test_suite_succeeded' },
      { memoryId: 'mem_cand_2', state: 'ACTIVE', confidence: 1.0, reason: 'test_suite_succeeded' },
    ]);
  });

  // US-033 — Diagnóstico aprofundado de observabilidade e métricas de saúde
  it('AC-084: Exposição de métricas granulares de ciclo de vida no brain_status @spec:AC-084', () => {
    const status = brainStatus({
      project: 'proj-1',
      head: 'head-1',
      backends: [
        { name: 'agentmemory', healthy: true, version: '0.9.29' },
        { name: 'code_review_graph', healthy: true, version: '2.3.7' },
      ],
      hooksHealthy: true,
      queueDepth: 0,
      verbose: true,
      metrics: {
        graphNodeCount: 420,
        memoryCounts: {
          ACTIVE: 25,
          POSSIBLY_STALE: 3,
          STALE: 1,
          SUPERSEDED: 2,
        },
        retrievalLatencyMs: 12,
      },
    });

    expect(status.status).toBe('ok');
    expect(status.result.metrics).toBeDefined();
    expect(status.result.metrics.graphNodeCount).toBe(420);
    expect(status.result.metrics.memoryCounts.ACTIVE).toBe(25);
    expect(status.result.metrics.memoryCounts.STALE).toBe(1);
    expect(status.result.metrics.retrievalLatencyMs).toBe(12);
  });

  // US-033 — Diagnóstico aprofundado de observabilidade e métricas de saúde
  it('AC-085: Alerta de saúde quando memórias obsoletas excederem limite seguro @spec:AC-085', () => {
    // 5 active, 5 stale out of 10 = 50% stale (> 20% threshold)
    const statusHighStale = brainStatus({
      project: 'proj-1',
      head: 'head-1',
      backends: [
        { name: 'agentmemory', healthy: true, version: '0.9.29' },
        { name: 'code_review_graph', healthy: true, version: '2.3.7' },
      ],
      hooksHealthy: true,
      queueDepth: 0,
      metrics: {
        memoryCounts: {
          ACTIVE: 5,
          POSSIBLY_STALE: 0,
          STALE: 5,
          SUPERSEDED: 0,
        },
      },
    });

    expect(statusHighStale.status).toBe('degraded');
    expect(statusHighStale.warnings.some((w) => w.includes('high stale memory ratio'))).toBe(true);

    // Queue depth > 5 triggers alert
    const statusHighQueue = brainStatus({
      project: 'proj-1',
      head: 'head-1',
      backends: [
        { name: 'agentmemory', healthy: true, version: '0.9.29' },
        { name: 'code_review_graph', healthy: true, version: '2.3.7' },
      ],
      hooksHealthy: true,
      queueDepth: 8,
    });

    expect(statusHighQueue.status).toBe('degraded');
    expect(statusHighQueue.warnings.some((w) => w.includes('hook queue depth is high'))).toBe(true);
  });
});
