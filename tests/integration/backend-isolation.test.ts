import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { installIiiEngineArtifact, sha256Artifact } from '../../src/runtime/iii-engine.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { createRuntimeIsolation } from '../../src/runtime/lock-manifest.js';
import { installManagedRuntime } from '../../src/cli/install.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

test('AC-047: worktrees recebem quatro portas e diretórios físicos distintos @spec:AC-047', () => {
  const dataDir = path.join(tmpdir(), 'mega-brain-backend-isolation');
  const first = deriveProjectIdentity({ root: path.join(dataDir, 'one'), gitDir: '.git', commonGitDir: '.git' });
  const second = deriveProjectIdentity({ root: path.join(dataDir, 'two'), gitDir: '.git', commonGitDir: '.git' });
  const left = createRuntimeIsolation(runtimeLayout(dataDir, first), first.worktreeId);
  const right = createRuntimeIsolation(runtimeLayout(dataDir, second), second.worktreeId);

  expect(new Set(Object.values(left.ports)).size).toBe(4);
  expect(new Set(Object.values(right.ports)).size).toBe(4);
  expect(Object.values(left.paths).every(path.isAbsolute)).toBe(true);
  expect(Object.values(right.paths).every(path.isAbsolute)).toBe(true);
  expect(left.paths).not.toEqual(right.paths);
  expect(left.ports).not.toEqual(right.ports);
});

test('AC-044: iii-engine pinado só é instalado após confirmação e checksum @spec:AC-044', async () => {
  const root = path.join(tmpdir(), `mega-brain-iii-${process.pid}-${Date.now()}`);
  directories.push(root);
  const artifact = Buffer.from('verified-iii-engine-artifact');
  const destination = path.join(root, process.platform === 'win32' ? 'iii.exe' : 'iii');

  await expect(installIiiEngineArtifact({
    destination,
    version: '0.11.2',
    confirmed: false,
    expectedSha256: sha256Artifact(artifact),
    download: async () => artifact,
  })).rejects.toThrow(/confirmation/i);

  await expect(installIiiEngineArtifact({
    destination,
    version: '0.11.2',
    confirmed: true,
    expectedSha256: '0'.repeat(64),
    download: async () => artifact,
  })).rejects.toThrow(/checksum/i);

  await installIiiEngineArtifact({
    destination,
    version: '0.11.2',
    confirmed: true,
    expectedSha256: sha256Artifact(artifact),
    download: async () => artifact,
  });
  expect(await readFile(destination)).toEqual(artifact);
});

test('AC-044: install gerenciado no Windows mantém iii-engine no namespace do projeto @spec:AC-044', async () => {
  const dataDir = path.join(tmpdir(), `mega-brain-iii-install-${process.pid}-${Date.now()}`);
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const artifact = Buffer.from('verified-project-local-iii-engine');
  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    platform: 'win32',
    preflight: false,
    runner: { run: async () => undefined },
    iiiEngine: {
      confirmed: true,
      expectedSha256: sha256Artifact(artifact),
      download: async () => artifact,
    },
  });

  expect(manifest.versions.iiiEngine).toBe('0.11.2');
  expect(await readFile(path.join(manifest.isolation!.paths.iiiEngine, 'iii.exe'))).toEqual(artifact);
  expect(manifest.isolation!.paths.iiiEngine).toContain(identity.worktreeId);
});
