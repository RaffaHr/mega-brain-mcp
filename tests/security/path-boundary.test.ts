import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { GitRepository } from '../../src/adapters/git/repository.js';
import { safeReadTrackedFile } from '../../src/adapters/git/safe-read.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { supervisorPaths } from '../../src/runtime/supervisor-manifest.js';

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

test('AC-020: leitura direta permanece dentro do repositório autorizado @spec:AC-020', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-git-'));
  directories.push(root);
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, 'tracked.txt'), 'one\ntwo\nthree\n', 'utf8');
  const repository = Object.create(GitRepository.prototype) as GitRepository;
  Object.defineProperty(repository, 'root', { value: root });

  const result = await safeReadTrackedFile(repository, 'tracked.txt', {
    maxLines: 2,
    isTracked: async (file) => file === 'tracked.txt',
  });
  expect(result).toMatchObject({ content: 'one\ntwo', truncated: true });

  await expect(safeReadTrackedFile(repository, '../outside.txt')).rejects.toThrow(/traversal/);
  await expect(safeReadTrackedFile(repository, path.resolve(root, 'tracked.txt'))).rejects.toThrow(/relative/);
  await expect(safeReadTrackedFile(repository, 'ignored.txt', {
    resolveRealPath: async (value) => path.resolve(value),
    isTracked: async () => false,
  })).rejects.toThrow(/not tracked/);
  await expect(safeReadTrackedFile(repository, 'link.txt', {
    resolveRealPath: async (value) => value.endsWith('link.txt') ? path.resolve(root, '..', 'secret.txt') : path.resolve(value),
    isTracked: async () => true,
  })).rejects.toThrow(/outside/);
});

test('AC-048: manifest, lock e socket do supervisor ficam no namespace do worktree @spec:AC-048', () => {
  const dataDir = path.resolve('isolated-runtime-data');
  const identity = deriveProjectIdentity({ root: path.resolve('repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId);

  for (const candidate of [paths.manifest, paths.startupLock]) {
    const relative = path.relative(layout.projectRoot, candidate);
    expect(relative.startsWith('..')).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  }
  if (process.platform !== 'win32') expect(paths.ipcAddress.startsWith(layout.projectRoot)).toBe(true);
  else expect(paths.ipcAddress).toMatch(/^\\\\\.\\pipe\\mega-brain-[a-f0-9]{24}$/u);
});
