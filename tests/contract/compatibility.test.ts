import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { loadCompatibilityManifest } from '../../src/compatibility/manifest.js';
import { CompatibilityError, negotiateCompatibility } from '../../src/compatibility/negotiate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('pinned backend contracts', () => {
  test.each([
    ['agentmemory-0.9.29.json', 'agentmemory', '0.9.29'],
    ['crg-2.3.7.json', 'code-review-graph', '2.3.7'],
  ])('loads and verifies %s', async (file, backend, version) => {
    const manifest = await loadCompatibilityManifest(path.join(root, 'compatibility', file));
    expect(manifest).toMatchObject({ backend, version });
  });

  test('accepts only an exact, schema-compatible observation', async () => {
    const manifest = await loadCompatibilityManifest(path.join(root, 'compatibility', 'crg-2.3.7.json'));
    const observation = {
      distribution: manifest.distribution,
      version: manifest.version,
      protocol: manifest.protocol,
      capabilities: manifest.capabilities.map(({ name, schemaHash }) => ({ name, schemaHash })),
    };

    expect(negotiateCompatibility(manifest, observation).compatible).toBe(true);
    expect(() =>
      negotiateCompatibility(manifest, {
        ...observation,
        capabilities: [...observation.capabilities, { name: 'build_or_update_graph_tool', schemaHash: 'sha256:unsafe' }],
      }),
    ).toThrow(CompatibilityError);
    expect(() =>
      negotiateCompatibility(manifest, {
        ...observation,
        capabilities: observation.capabilities.map((capability, index) =>
          index === 0 ? { ...capability, schemaHash: `sha256:${'0'.repeat(64)}` } : capability,
        ),
      }),
    ).toThrow(CompatibilityError);
  });

  test('AC-049/AC-052: contracts declare namespace and storage isolation @spec:AC-049 @spec:AC-052', async () => {
    const agentMemory = await loadCompatibilityManifest(path.join(root, 'compatibility', 'agentmemory-0.9.29.json'));
    const crg = await loadCompatibilityManifest(path.join(root, 'compatibility', 'crg-2.3.7.json'));

    expect(agentMemory.isolation?.namespaceField).toBe('project');
    expect(crg.isolation?.requiredEnvironment).toEqual(['CRG_DATA_DIR', 'CRG_REPO_ROOT']);
  });
});
