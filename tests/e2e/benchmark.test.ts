import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'vitest';

import { loadBenchmark } from '../../benchmark/runner.js';

const root = path.resolve(import.meta.dirname, '..', '..');

test('AC-024: benchmark comprova economia sem reduzir qualidade @spec:AC-024', async () => {
  const report = await loadBenchmark(
    path.join(root, 'benchmark', 'questions.json'),
    path.join(root, 'benchmark', 'mutations.json'),
  );
  expect(report.questionCount).toBeGreaterThanOrEqual(50);
  expect(report.questionCount).toBeLessThanOrEqual(100);
  expect(report.megaBrainQuality).toBeGreaterThanOrEqual(report.baselineQuality);
  expect(report.contextReduction).toBeGreaterThanOrEqual(0.6);
  expect(report.rawCodeFallbackRate).toBeLessThanOrEqual(0.25);
  expect(report.incorrectFresh).toBe(0);
  expect(report.mutationFreshViolations).toBe(0);
  expect(report.passed).toBe(true);
});

test('AC-025: release exige matriz suportada e audit limpo @spec:AC-025', async () => {
  const ci = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const release = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
  for (const platform of ['ubuntu-latest', 'windows-latest']) expect(ci).toContain(platform);
  for (const host of ['Codex', 'Claude']) expect(ci).toContain(host);
  expect(ci).toContain('onp-spec audit --ci');
  expect(release).toContain('npm publish --provenance');
  expect(packageJson.license).toBe('Apache-2.0');
});
