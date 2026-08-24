import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const supportedNodes = ['22.22.0', '24.19.0'];

type PackageLock = {
  packages: Record<string, { engines?: { node?: string }; version?: string }>;
};

function versionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  return actualParts.some((part, index) =>
    part !== minimumParts[index] ? part > minimumParts[index] : false,
  ) || actualParts.every((part, index) => part === minimumParts[index]);
}

function supportsNode(range: string, version: string): boolean {
  return range.split('||').some((alternative) => {
    const minimum = alternative.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1];
    return minimum !== undefined && versionAtLeast(version, minimum);
  });
}

describe('Node support contract', () => {
  test('@spec:AC-029 declares and certifies the Node 22.22+/24.19 matrix', async () => {
    const [packageText, lockText, ci, release] = await Promise.all([
      readFile(path.join(root, 'package.json'), 'utf8'),
      readFile(path.join(root, 'package-lock.json'), 'utf8'),
      readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'),
      readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8'),
    ]);
    const manifest = JSON.parse(packageText) as { engines: { node: string } };
    const lock = JSON.parse(lockText) as PackageLock;

    expect(manifest.engines.node).toBe('>=22.22.0');
    expect(lock.packages[''].engines?.node).toBe('>=22.22.0');
    expect(ci).toMatch(/os: \[ubuntu-latest, windows-latest\]/);
    expect(ci).toMatch(/node: \[22\.22\.0, 24\.19\.0\]/);
    expect(release).toMatch(/node-version: 22\.22\.0/);

    for (const dependency of ['node_modules/mcp-use', 'node_modules/posthog-node']) {
      const engine = lock.packages[dependency]?.engines?.node;
      expect(engine, `${dependency} must declare a Node engine`).toBeTypeOf('string');
      for (const node of supportedNodes) {
        expect(supportsNode(engine as string, node), `${dependency} must support Node ${node}`).toBe(true);
      }
    }
  });
});
