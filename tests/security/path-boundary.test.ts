import { chmod, mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { GitRepository } from '../../src/adapters/git/repository.js';
import { safeReadTrackedFile } from '../../src/adapters/git/safe-read.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { startProjectSupervisor } from '../../src/runtime/project-supervisor.js';
import { supervisorPaths } from '../../src/runtime/supervisor-manifest.js';

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const SHORTEST_POSIX_SOCKET_LIMIT = 104;

/**
 * Builds a real data directory deep enough that the preferred supervisor socket
 * address cannot fit `sun_path` on any platform, so the temporary directory
 * fallback is exercised deterministically instead of depending on how long the
 * system temporary directory happens to be.
 */
async function deepDataDir(prefix: string): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(base);
  let dataDir = base;
  while (dataDir.length < 120) dataDir = path.join(dataDir, 'padding');
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}

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

test('AC-048: manifest e lock ficam no namespace do worktree e o socket fica em diretório exclusivo do usuário @spec:AC-048', () => {
  const dataDir = path.resolve('isolated-runtime-data');
  const identity = deriveProjectIdentity({ root: path.resolve('repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId);

  for (const candidate of [paths.manifest, paths.startupLock]) {
    const relative = path.relative(layout.projectRoot, candidate);
    expect(relative.startsWith('..')).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  }

  if (process.platform === 'win32') {
    expect(paths.ipcAddress).toMatch(/^\\\\\.\\pipe\\mega-brain-[a-f0-9]{24}$/u);
    return;
  }

  const shortLayout = runtimeLayout('/tmp/mb', identity);
  const shortPaths = supervisorPaths(shortLayout, identity.worktreeId);
  expect(shortPaths.ipcAddress.startsWith(shortLayout.projectRoot)).toBe(true);

  const deepLayout = runtimeLayout(`/tmp/${'d'.repeat(120)}`, identity);
  const deepPaths = supervisorPaths(deepLayout, identity.worktreeId);
  expect(Buffer.byteLength(deepPaths.ipcAddress)).toBeLessThanOrEqual(SHORTEST_POSIX_SOCKET_LIMIT);
  expect(path.dirname(deepPaths.ipcAddress)).not.toBe(tmpdir());
  expect(path.dirname(path.dirname(deepPaths.ipcAddress))).toBe(tmpdir());

  const other = deriveProjectIdentity({ root: path.resolve('other-repo'), gitDir: '.git', commonGitDir: '.git' });
  const otherPaths = supervisorPaths(runtimeLayout(`/tmp/${'d'.repeat(120)}`, other), other.worktreeId);
  expect(deepPaths.ipcAddress).not.toBe(otherPaths.ipcAddress);
});

test('AC-048: socket fora do projectRoot nasce em diretório 0700 do usuário com socket 0600 @spec:AC-048', async () => {
  if (process.platform === 'win32') return;
  const dataDir = await deepDataDir('mega-brain-socket-containment-');
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId);
  const socketDirectory = path.dirname(paths.ipcAddress);
  directories.push(socketDirectory);

  expect(paths.ipcAddress.startsWith(layout.projectRoot)).toBe(false);
  await mkdir(socketDirectory, { recursive: true });
  await chmod(socketDirectory, 0o777);

  const server = await startProjectSupervisor({ layout, identity, pid: process.pid });
  try {
    expect(path.dirname(server.manifest.ipcAddress)).toBe(socketDirectory);
    expect((await stat(socketDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(server.manifest.ipcAddress)).mode & 0o777).toBe(0o600);
  } finally {
    await server.close();
  }
});

test('AC-048: supervisor recusa socket em diretório que não é um diretório do usuário @spec:AC-048', async () => {
  if (process.platform === 'win32') return;
  const dataDir = await deepDataDir('mega-brain-socket-squat-');
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId);
  const socketDirectory = path.dirname(paths.ipcAddress);
  directories.push(socketDirectory);
  const decoy = path.join(dataDir, 'decoy');
  await mkdir(decoy, { recursive: true });
  await symlink(decoy, socketDirectory);

  await expect(startProjectSupervisor({ layout, identity, pid: process.pid }))
    .rejects.toThrow(/must be a directory owned by the current user/u);
  await expect(stat(paths.ipcAddress)).rejects.toMatchObject({ code: 'ENOENT' });
});
