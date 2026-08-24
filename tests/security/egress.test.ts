import { expect, test } from 'vitest';

import { CRG_READ_ONLY_TOOLS } from '../../src/adapters/code-review-graph/allowlist.js';
import { EgressDeniedError, EgressPolicy } from '../../src/security/egress-policy.js';

test('AC-021: cloud e tools mutantes permanecem desabilitados por padrão @spec:AC-021', () => {
  const policy = new EgressPolicy();
  expect(policy.snapshot()).toEqual({ externalEgress: false, llm: false });
  expect(() => policy.assertUrl('https://api.example.com')).toThrow(EgressDeniedError);
  expect(policy.assertUrl('http://127.0.0.1:3111').hostname).toBe('127.0.0.1');
  expect(CRG_READ_ONLY_TOOLS.every((tool) => !/(?:update|delete|index|write|create)/i.test(tool))).toBe(true);
});

test('P-007: egress e consumo de LLM são opt-in @principle:P-007', () => {
  expect(() => new EgressPolicy({ allowEgress: true }).assertLlm()).toThrow('LLM consumption is disabled');
  expect(() => new EgressPolicy({ allowLlm: true }).assertLlm()).toThrow('requires external egress');
  const optedIn = new EgressPolicy({ allowEgress: true, allowLlm: true });
  expect(() => optedIn.assertLlm()).not.toThrow();
  expect(optedIn.snapshot()).toEqual({ externalEgress: true, llm: true });
});
