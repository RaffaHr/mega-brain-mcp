import { expect, test, vi } from 'vitest';

import { createJsonPromptAdapter, type PromptAdapter } from '../../src/cli/prompts.js';

test('JSON prompt adapter suprime decoração e registra warnings estruturados', async () => {
  const confirm = vi.fn(async () => true);
  const notify = vi.fn();
  const base: PromptAdapter = {
    interactive: true,
    input: async (_id, _message, defaultValue = '') => defaultValue,
    select: async (_id, _message, _choices, defaultValue) => defaultValue,
    confirm,
    explain: notify,
    notify,
  };
  const structured = createJsonPromptAdapter(base);

  await structured.prompts.intro?.();
  structured.prompts.explain?.('decorative panel');
  structured.prompts.notify('Setup summary');
  await structured.prompts.confirm('allowEgress', '[IMPORTANT] Allow provider network egress?', true);

  expect(notify).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith('allowEgress', 'Allow provider network egress?', true);
  expect(structured.warnings()).toEqual([{
    level: 'important',
    code: 'SETUP_ALLOW_EGRESS',
    message: 'Allow provider network egress?',
    requiresAttention: true,
  }]);
});
