import { describe, expect, test } from 'vitest';

import { buildChangeContext } from '../../src/orchestration/change-context.js';

describe('change-context ranking and budget packaging', () => {
  test('AC-066: memórias do AgentMemory não recebem penalidade fixa e competem em igualdade sob budget @spec:AC-066', async () => {
    const result = await buildChangeContext(
      { target: 'src/checkout.ts', budget: 'FAST' },
      {
        structure: async () => ({
          dependencies: ['src/payment.ts', 'src/user.ts'],
          flows: ['checkout-flow', 'payment-flow'],
          tests: ['tests/checkout.test.ts'],
        }),
        experience: async () => ({
          rules: ['Rule: never mutate order in-flight without locking'],
          bugs: ['Bug: race condition when payment times out'],
          decisions: ['Decision: use idempotent key for third party gateway'],
          risks: ['Risk: double charge if webhook retries concurrently'],
        }),
        maxTokenBudget: 500,
      },
    );

    // Verify context contains rules, bugs or decisions without being universally dropped
    expect(result.context).toContain('Rules:');
    expect(result.context).toContain('never mutate order in-flight without locking');
    expect(result.context).toContain('Bugs:');
    expect(result.context).toContain('race condition when payment times out');
  });
});
