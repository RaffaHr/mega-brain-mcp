// Testes de spec da feature p0-memory-dedup-cleanup
import { describe, expect, it } from 'vitest';
import { brainLearn } from '../src/tools/brain-learn.js';
import { buildContextPack } from '../src/orchestration/context-builder.js';

describe('p0-memory-dedup-cleanup', () => {
  // US-026 — Despoluição de reforço e supersessão no AgentMemory
  it('AC-070: Reforço de memória sem geração de registro textual duplicado @spec:AC-070', async () => {
    const savedCalls = [];
    const reinforceCalls = [];
    const store = {
      async findEquivalent(stmt) {
        if (stmt.includes('checkout usa stripe')) {
          return { id: 'mem_123', statement: 'checkout usa stripe' };
        }
        return undefined;
      },
      async save(input) {
        savedCalls.push(input);
        return { id: 'mem_456' };
      },
      async reinforce(id, evidence) {
        reinforceCalls.push({ id, evidence });
      },
      async recordConflict() {},
      async supersede() {},
    };

    const res = await brainLearn({
      project: 'proj-1',
      head: 'head-1',
      statement: 'checkout usa stripe',
      type: 'rule',
    }, store);

    expect(res.status).toBe('ok');
    expect(res.result.action).toBe('reinforced');
    expect(reinforceCalls.length).toBe(1);
    expect(savedCalls.length).toBe(0);
  });

  // US-026 — Despoluição de reforço e supersessão no AgentMemory
  it('AC-071: Rastreabilidade de supersessão sem poluição do espaço vetorial @spec:AC-071', async () => {
    const savedCalls = [];
    const supersedeCalls = [];
    const store = {
      async findEquivalent() {
        return undefined;
      },
      async save(input) {
        savedCalls.push(input);
        return { id: 'mem_new_999' };
      },
      async reinforce() {},
      async recordConflict() {},
      async supersede(existingId, replacementId) {
        supersedeCalls.push({ existingId, replacementId });
      },
    };

    const res = await brainLearn({
      project: 'proj-1',
      head: 'head-1',
      statement: 'checkout agora usa adyen',
      type: 'decision',
      supersedes: 'mem_old_111',
    }, store);

    expect(res.status).toBe('ok');
    expect(res.result.action).toBe('supersession');
    expect(supersedeCalls).toEqual([{ existingId: 'mem_old_111', replacementId: 'mem_new_999' }]);
    expect(savedCalls.length).toBe(1);
    expect(savedCalls[0].statement).toBe('checkout agora usa adyen');
  });

  // US-027 — Truncamento seguro de blocos e deduplicação semântica no Context Builder
  it('AC-072: Truncamento seguro de blocos de contexto respeitando limites sintáticos @spec:AC-072', () => {
    const longChunk = {
      id: 'c1',
      source: 'code_review_graph',
      text: 'line 1\nline 2\nline 3\nline 4\nline 5\n' + 'a'.repeat(3000),
      retrieval: 1,
      intentFit: 1,
      freshness: 1,
      confidence: 1,
      provenance: 1,
      reinforcement: 1,
      reference: 'file.ts',
    };

    const pack = buildContextPack([longChunk], 'FAST');
    expect(pack.estimatedTokens).toBeLessThanOrEqual(500);
    expect(pack.text).toContain('[code_review_graph] file.ts');
    expect(pack.text).not.toContain('a'.repeat(1000));
  });

  // US-027 — Truncamento seguro de blocos e deduplicação semântica no Context Builder
  it('AC-073: Deduplicação semântica normalizada antes do empacotamento @spec:AC-073', () => {
    const chunkA = {
      id: 'c1',
      source: 'agentmemory',
      text: 'Auth uses JWT with RS256',
      retrieval: 0.8,
      intentFit: 0.8,
      freshness: 0.8,
      confidence: 0.7,
      provenance: 0.8,
      reinforcement: 0,
      reference: 'mem1',
    };
    const chunkB = {
      id: 'c2',
      source: 'agentmemory',
      text: '  auth   uses jwt with rs256  ',
      retrieval: 0.9,
      intentFit: 0.9,
      freshness: 1.0,
      confidence: 0.95,
      provenance: 0.9,
      reinforcement: 0,
      reference: 'mem2',
    };

    const pack = buildContextPack([chunkA, chunkB], 'NORMAL');
    expect(pack.chunks.length).toBe(1);
    expect(pack.chunks[0].id).toBe('c2');
  });
});
