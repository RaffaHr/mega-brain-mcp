import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { loadCompatibilityManifest } from '../../src/compatibility/manifest.js';
import { CompatibilityError, negotiateCompatibility } from '../../src/compatibility/negotiate.js';
import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS } from '../../src/runtime/dependency-versions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const agentMemoryManifestFile = `agentmemory-${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory}.json`;
const codeReviewGraphManifestFile = `crg-${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph}.json`;

describe('pinned backend contracts', () => {
  test.each([
    [agentMemoryManifestFile, 'agentmemory', DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory],
    [codeReviewGraphManifestFile, 'code-review-graph', DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph],
  ])('loads and verifies %s', async (file, backend, version) => {
    const manifest = await loadCompatibilityManifest(path.join(root, 'compatibility', file));
    expect(manifest).toMatchObject({ backend, version });
  });

  test('accepts only an exact, schema-compatible observation', async () => {
    const manifest = await loadCompatibilityManifest(path.join(root, 'compatibility', codeReviewGraphManifestFile));
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
    const agentMemory = await loadCompatibilityManifest(path.join(root, 'compatibility', agentMemoryManifestFile));
    const crg = await loadCompatibilityManifest(path.join(root, 'compatibility', codeReviewGraphManifestFile));

    expect(agentMemory.isolation?.namespaceField).toBe('project');
    expect(crg.isolation?.requiredEnvironment).toEqual(['CRG_DATA_DIR', 'CRG_REPO_ROOT']);
  });
});
