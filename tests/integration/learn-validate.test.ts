import { expect, test, vi } from 'vitest';

import { brainLearn, type LearningStore } from '../../src/tools/brain-learn.js';
import { brainValidate } from '../../src/tools/brain-validate.js';

function store(existing?: { id: string; statement: string; negated?: boolean }): LearningStore {
  return {
    findEquivalent: vi.fn(async () => existing),
    save: vi.fn(async () => ({ id: 'new-memory' })),
    reinforce: vi.fn(async () => undefined),
    recordConflict: vi.fn(async () => undefined),
    supersede: vi.fn(async () => undefined),
  };
}

test('AC-007: evidência define autoridade e confiança @spec:AC-007', async () => {
  const verified = await brainLearn({ project: 'shop', head: 'abc', statement: 'JWT is used', type: 'fact', evidence: [
    { path: 'src/auth.ts', blobHash: 'blob', commitHash: 'abc' },
  ] }, store());
  const unverified = await brainLearn({ project: 'shop', head: 'abc', statement: 'JWT may be used', type: 'experience' }, store());
  expect(verified.result.authority).toBe('verified');
  expect(verified.confidence).toBe(1);
  expect(unverified.result.authority).toBe('unverified');
  expect(unverified.confidence).toBeLessThanOrEqual(0.3);
});

test('AC-008: duplicatas e contradições evoluem sem apagar história @spec:AC-008', async () => {
  const duplicateStore = store({ id: 'old', statement: 'Use JWT' });
  const duplicate = await brainLearn({ project: 'shop', head: 'abc', statement: ' use   jwt ', type: 'decision' }, duplicateStore);
  expect(duplicate.result.action).toBe('reinforced');
  expect(duplicateStore.reinforce).toHaveBeenCalledWith('old', []);

  const supersessionStore = store();
  const replacement = await brainLearn({ project: 'shop', head: 'abc', statement: 'Use sessions', type: 'decision', supersedes: 'old' }, supersessionStore);
  expect(replacement.result.action).toBe('supersession');
  expect(supersessionStore.supersede).toHaveBeenCalledWith('old', 'new-memory');
});

test('AC-009: conteúdo sensível não alcança a memória @spec:AC-009', async () => {
  const learningStore = store();
  await brainLearn({ project: 'shop', head: 'abc', statement: 'Authorization: Bearer top.secret.token password=hunter2', type: 'fact' }, learningStore);
  const saved = vi.mocked(learningStore.save).mock.calls[0]?.[0];
  expect(saved?.statement).not.toContain('top.secret.token');
  expect(saved?.statement).not.toContain('hunter2');
  expect(saved?.statement).toContain('[REDACTED]');
});

test('AC-015: validação atualiza estado e não conteúdo @spec:AC-015', async () => {
  const validationStore = {
    assess: vi.fn(async () => ({ state: 'FRESH' as const, confidence: 1, reasons: ['hash_match'] })),
    record: vi.fn(async () => undefined),
  };
  const result = await brainValidate({ project: 'shop', head: 'abc', memoryIds: ['memory-1'] }, validationStore);
  expect(validationStore.record).toHaveBeenCalledTimes(1);
  expect(result.result.contentUpdated).toBe(false);
});
