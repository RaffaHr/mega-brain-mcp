import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const proofs: Record<string, string[]> = {
  'AC-039': ['integration/stdio-mcp.test.ts', 'e2e/autonomous-lifecycle.test.ts'],
  'AC-040': ['integration/project-supervisor.test.ts'],
  'AC-041': ['unit/leases.test.ts', 'e2e/autonomous-lifecycle.test.ts'],
  'AC-042': ['integration/setup.test.ts'],
  'AC-043': ['integration/setup.test.ts', 'integration/runtime-manager.test.ts'],
  'AC-044': ['integration/backend-isolation.test.ts', 'e2e/autonomous-lifecycle.test.ts'],
  'AC-045': ['integration/setup.test.ts', 'integration/install-transaction.test.ts'],
  'AC-046': ['unit/project-identity.test.ts'],
  'AC-047': ['integration/backend-isolation.test.ts', 'e2e/concurrent-projects.test.ts'],
  'AC-048': ['integration/project-supervisor.test.ts', 'e2e/concurrent-projects.test.ts'],
  'AC-049': ['integration/remote-agentmemory.test.ts', 'contract/agentmemory.test.ts'],
  'AC-050': ['unit/config.test.ts'],
  'AC-051': ['unit/config.test.ts'],
  'AC-052': ['contract/code-review-graph.test.ts'],
  'AC-053': ['unit/config.test.ts'],
  'AC-054': ['integration/install-transaction.test.ts'],
  'AC-055': ['contract/package-boundary.test.ts'],
  'AC-056': ['e2e/concurrent-projects.test.ts', 'contract/package-boundary.test.ts'],
};

for (const [criterion, files] of Object.entries(proofs)) {
  test(`${criterion}: possui prova executável vinculada fora do scaffold @spec:${criterion}`, async () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(path.join(root, 'tests', file), 'utf8');
      expect(source, `${criterion} ausente em ${file}`).toContain(`@spec:${criterion}`);
      expect(source).not.toContain('ainda não provado');
    }
  });
}
