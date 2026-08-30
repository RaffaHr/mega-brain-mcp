import { afterEach, expect, test } from 'vitest';

import { main } from '../../src/cli/index.js';

const initialExitCode = process.exitCode;
afterEach(() => { process.exitCode = initialExitCode; });

test('setup --json em contexto não interativo emite somente erro estruturado', async () => {
  const output: string[] = [];
  await main(['setup', '--json'], (value) => output.push(value));

  expect(output).toHaveLength(1);
  expect(output[0]).not.toContain('\x1b[');
  expect(JSON.parse(output[0]!)).toMatchObject({
    status: 'failed',
    level: 'error',
    code: 'SETUP_FAILED',
    requiresAttention: true,
    warnings: [],
    steps: [],
  });
  expect(process.exitCode).toBe(1);
});
