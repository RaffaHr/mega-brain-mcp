import { describe, expect, test } from 'vitest';

import { brainChangeContext } from '../../src/tools/brain-change-context.js';
import { brainHistory } from '../../src/tools/brain-history.js';

describe('change context and history', () => {
  test('AC-013: contexto de mudança reúne impacto e experiência @spec:AC-013', async () => {
    const response = await brainChangeContext({ target: 'src/payments.ts', budget: 'FAST' }, {
      project: 'shop',
      head: 'abc123',
      structure: async () => ({
        dependencies: ['PaymentGateway'],
        flows: ['checkout'],
        tests: ['payments.test.ts'],
      }),
      experience: async () => ({
        rules: ['Never retry declined cards'],
        bugs: ['Duplicate capture'],
        decisions: ['Use idempotency keys'],
        risks: ['Gateway timeout'],
      }),
    });
    expect(response.status).toBe('ok');
    expect(response.result).toMatchObject({
      dependencies: ['PaymentGateway'],
      flows: ['checkout'],
      tests: ['payments.test.ts'],
      rules: ['Never retry declined cards'],
      bugs: ['Duplicate capture'],
      decisions: ['Use idempotency keys'],
      risks: ['Gateway timeout'],
      budget: 500,
    });
    expect(response.sources.map(({ kind }) => kind)).toEqual(['code_review_graph', 'agentmemory']);
  });

  test('AC-014: histórico combina memória e Git sem reescrever o passado @spec:AC-014', async () => {
    const historicalCommit = {
      id: 'c1', source: 'git' as const, occurredAt: '2026-01-01T10:00:00.000Z',
      summary: 'Old implementation', reference: 'c1',
    };
    const response = await brainHistory({
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-03T00:00:00.000Z',
      limit: 10,
    }, {
      project: 'shop',
      head: 'head2',
      commits: async () => [historicalCommit],
      memories: async () => [{
        id: 'm1', source: 'agentmemory_memory', occurredAt: '2026-01-02T10:00:00.000Z',
        summary: 'Learned retry policy', reference: 'memory:m1',
      }],
      sessions: async () => [{
        id: 's0', source: 'agentmemory_session', occurredAt: '2025-12-01T10:00:00.000Z',
        summary: 'Outside range', reference: 'session:s0',
      }],
      currentStructure: async () => ({ implementation: 'Current implementation', head: 'head2' }),
    });
    expect(response.result.timeline).toEqual([
      historicalCommit,
      expect.objectContaining({ id: 'm1', source: 'agentmemory_memory' }),
    ]);
    expect(response.result.currentStructure).toEqual({ implementation: 'Current implementation', head: 'head2' });
    expect(response.result.separation).toBe('historical_events_are_immutable_current_structure_is_a_snapshot');
    expect(response.result.timeline).not.toContainEqual(expect.objectContaining({ implementation: 'Current implementation' }));
  });
});
