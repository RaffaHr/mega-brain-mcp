import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { deriveProjectIdentity } from '../../src/projects/identity.js';
import {
  ensureProjectSupervisor,
  startProjectSupervisor,
  type SupervisorProcessSpawner,
} from '../../src/runtime/project-supervisor.js';
import { runtimeLayout, type RuntimeLayout } from '../../src/runtime/layout.js';
import { readSupervisorManifest, supervisorManifestSchema, supervisorPaths, writeSupervisorManifest } from '../../src/runtime/supervisor-manifest.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/**
 * Polls until the idle shutdown removed the manifest instead of sleeping for a
 * fixed slice, so a slow runner delays the assertion rather than failing it.
 */
async function waitForManifestRemoval(layout: RuntimeLayout, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const removed = await readSupervisorManifest(layout).then(
      () => false,
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
    );
    if (removed) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('supervisor manifest was not removed before the deadline');
}

/**
 * Binds a Unix domain socket in another process and kills it without letting it
 * unlink the address, reproducing what a supervisor killed with `SIGKILL`
 * leaves behind: the socket file survives, so connecting to it is refused
 * instead of reporting a missing address.
 */
async function abandonSocket(address: string): Promise<number> {
  await mkdir(path.dirname(address), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [
    '-e',
    `require('node:net').createServer().listen(${JSON.stringify(address)}, () => console.log('bound'));`,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  const bound = await new Promise<boolean>((resolve) => {
    child.stdout!.once('data', () => resolve(true));
    child.once('exit', () => resolve(false));
  });
  if (!bound) throw new Error(`could not bind a socket at ${address}`);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid!;
}

test('AC-040: gateways concorrentes iniciam e reutilizam um único supervisor independente @spec:AC-040', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-supervisor-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  let spawns = 0;
  let server: Awaited<ReturnType<typeof startProjectSupervisor>> | undefined;
  const spawner: SupervisorProcessSpawner = {
    async spawn() {
      spawns += 1;
      server = await startProjectSupervisor({ layout, identity, pid: 4242 });
      return 4242;
    },
  };

  const [first, second] = await Promise.all([
    ensureProjectSupervisor({ layout, identity, spawner, processExists: () => true }),
    ensureProjectSupervisor({ layout, identity, spawner, processExists: () => true }),
  ]);

  expect(spawns).toBe(1);
  expect(first.manifest.pid).toBe(4242);
  expect(second.manifest.worktreeId).toBe(identity.worktreeId);
  expect(Object.keys(await readSupervisorManifest(layout))).toEqual([
    'protocolVersion', 'worktreeId', 'pid', 'ipcAddress', 'startedAt', 'updatedAt',
  ]);

  await first.client.acquire('gateway-one');
  await second.client.acquire('gateway-two');
  expect((await first.client.status()).leases).toEqual(['gateway-one', 'gateway-two']);
  await first.client.release('gateway-one');
  await second.client.release('gateway-two');
  await first.client.close();
  await second.client.close();
  await server?.close();
});

test('AC-048: handshake IPC rejeita outro worktree e o manifest não aceita campos secretos @spec:AC-048', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-ipc-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const other = deriveProjectIdentity({ root: path.join(dataDir, 'other'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const server = await startProjectSupervisor({ layout, identity, pid: process.pid });

  await expect(ensureProjectSupervisor({
    layout,
    identity: other,
    spawner: { spawn: async () => { throw new Error('must not spawn'); } },
    processExists: () => true,
  })).rejects.toThrow(/worktree|identity/i);

  const manifest = await readSupervisorManifest(layout);
  expect(() => supervisorManifestSchema.parse({
    ...manifest,
    authToken: 'forbidden',
  })).toThrow(/unrecognized|secret|token/i);
  await server.close();
});

test('AC-041: supervisor encerra cinco segundos após a última lease @spec:AC-041', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-idle-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  let now = 0;
  let shutdowns = 0;
  const server = await startProjectSupervisor({
    layout,
    identity,
    now: () => now,
    onShutdown: () => { shutdowns += 1; },
  });
  const handle = await ensureProjectSupervisor({ layout, identity, processExists: () => true });

  await handle.client.acquire('last-gateway');
  await handle.client.release('last-gateway');
  now = 4_999;
  expect(await server.checkIdle()).toBe(false);
  now = 5_000;
  expect(await server.checkIdle()).toBe(true);
  expect(shutdowns).toBe(1);
  expect(server.registered()).toBe(true);
  await expect(readSupervisorManifest(layout)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('AC-041: shutdown ocioso que falha não derruba o supervisor por rejeição não tratada @spec:AC-041', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-idle-failure-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const rejections: unknown[] = [];
  const collectRejection = (reason: unknown): void => { rejections.push(reason); };
  process.on('unhandledRejection', collectRejection);
  const server = await startProjectSupervisor({
    layout,
    identity,
    pid: process.pid,
    leaseOptions: { shutdownGraceMs: 0 },
    onShutdown: () => Promise.reject(new Error('shutdown hook failed')),
  });

  try {
    const handle = await ensureProjectSupervisor({ layout, identity, processExists: () => true });
    await handle.client.acquire('idle-gateway');
    await handle.client.release('idle-gateway');
    await waitForManifestRemoval(layout);

    expect(rejections).toEqual([]);
    await expect(server.checkIdle()).resolves.toBe(false);
  } finally {
    process.off('unhandledRejection', collectRejection);
    await server.close();
  }
});

test('AC-041: falha ao liberar o IPC ainda libera quem aguarda o encerramento @spec:AC-041', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-close-failure-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const socketDirectory = path.dirname(supervisorPaths(layout, identity.worktreeId).ipcAddress);
  const server = await startProjectSupervisor({ layout, identity, pid: process.pid });

  await chmod(socketDirectory, 0o555);
  try {
    await expect(server.close()).rejects.toThrow();
    await expect(server.closed).resolves.toBeUndefined();
  } finally {
    await chmod(socketDirectory, 0o700);
  }
});

test('AC-041: checkIdle aguardado propaga a falha do shutdown ao chamador @spec:AC-041', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-idle-propagation-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  let now = 0;
  const server = await startProjectSupervisor({
    layout,
    identity,
    pid: process.pid,
    now: () => now,
    onShutdown: () => Promise.reject(new Error('shutdown hook failed')),
  });

  try {
    const handle = await ensureProjectSupervisor({ layout, identity, processExists: () => true });
    await handle.client.acquire('last-gateway');
    await handle.client.release('last-gateway');
    now = 5_000;
    await expect(server.checkIdle()).rejects.toThrow('shutdown hook failed');
  } finally {
    await server.close();
  }
});

test('AC-040: manifest cujo socket sumiu é reciclado por um supervisor novo @spec:AC-040', async () => {
  if (process.platform === 'win32') return;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-dead-socket-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  let shutdowns = 0;
  const orphan = await startProjectSupervisor({
    layout,
    identity,
    pid: process.pid,
    leaseOptions: { shutdownGraceMs: 0 },
    onShutdown: () => { shutdowns += 1; },
  });
  await rm(orphan.manifest.ipcAddress, { force: true });

  let replacement: Awaited<ReturnType<typeof startProjectSupervisor>> | undefined;
  const handle = await ensureProjectSupervisor({
    layout,
    identity,
    processExists: () => true,
    spawner: {
      async spawn() {
        replacement = await startProjectSupervisor({ layout, identity, pid: 7373 });
        return 7373;
      },
    },
  });

  try {
    expect(handle.reused).toBe(false);
    expect(handle.manifest.pid).toBe(7373);
    expect(handle.manifest.ipcAddress).not.toBe(orphan.manifest.ipcAddress);
    await handle.client.acquire('recovered-gateway');
    expect((await handle.client.status()).leases).toEqual(['recovered-gateway']);
    await handle.client.release('recovered-gateway');

    orphan.leases.acquire('stale-gateway');
    orphan.leases.release('stale-gateway');
    expect(await orphan.checkIdle()).toBe(false);
    expect(shutdowns).toBe(0);
    expect(orphan.registered()).toBe(false);

    await orphan.close();
    expect(await readSupervisorManifest(layout)).toMatchObject({ pid: 7373 });
    expect((await handle.client.status()).leases).toEqual([]);
  } finally {
    await handle.client.close();
    await replacement?.close();
    await orphan.close();
  }
});

test('AC-040: manifest cujo endpoint recusa conexão é reciclado mesmo com o pid reutilizado @spec:AC-040', async () => {
  if (process.platform === 'win32') return;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-refused-socket-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId, 'deadbeef');
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  directories.push(path.dirname(paths.ipcAddress));
  const killedPid = await abandonSocket(paths.ipcAddress);
  expect((await stat(paths.ipcAddress)).isSocket()).toBe(true);
  const startedAt = new Date(0).toISOString();
  await writeSupervisorManifest(layout, {
    protocolVersion: 1,
    worktreeId: identity.worktreeId,
    pid: killedPid,
    ipcAddress: paths.ipcAddress,
    startedAt,
    updatedAt: startedAt,
  });

  let replacement: Awaited<ReturnType<typeof startProjectSupervisor>> | undefined;
  const handle = await ensureProjectSupervisor({
    layout,
    identity,
    processExists: () => true,
    spawner: {
      async spawn() {
        replacement = await startProjectSupervisor({ layout, identity, pid: 4242 });
        return 4242;
      },
    },
  });

  try {
    expect(handle.reused).toBe(false);
    expect(handle.manifest.pid).toBe(4242);
    expect(handle.manifest.ipcAddress).not.toBe(paths.ipcAddress);
    await handle.client.acquire('gateway-after-sigkill');
    expect((await handle.client.status()).leases).toEqual(['gateway-after-sigkill']);
    expect(await readSupervisorManifest(layout)).toMatchObject({ pid: 4242 });
  } finally {
    await handle.client.close();
    await replacement?.close();
  }
});

test('AC-040: readiness que não é endereço inacessível preserva o manifest @spec:AC-040', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-readiness-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const server = await startProjectSupervisor({ layout, identity, pid: process.pid });
  const published = await readSupervisorManifest(layout);
  const impostor = { ...published, pid: published.pid + 1 };
  await writeSupervisorManifest(layout, impostor);

  try {
    await expect(ensureProjectSupervisor({
      layout,
      identity,
      processExists: () => true,
      spawner: { spawn: async () => { throw new Error('must not spawn'); } },
    })).rejects.toThrow(/readiness failed/u);
    await expect(readSupervisorManifest(layout)).resolves.toMatchObject({ pid: impostor.pid });
  } finally {
    await server.close();
  }
});

test('AC-054: drain preserva leases existentes e bloqueia novas aquisições @spec:AC-054', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-drain-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const server = await startProjectSupervisor({ layout, identity, pid: process.pid });
  const handle = await ensureProjectSupervisor({ layout, identity, processExists: () => true });

  await handle.client.acquire('existing-gateway');
  expect(await handle.client.drain()).toEqual({ leases: ['existing-gateway'] });
  expect(await handle.client.status()).toEqual({ leases: ['existing-gateway'], draining: true });
  await expect(handle.client.acquire('new-gateway')).rejects.toThrow(/draining/u);
  await handle.client.release('existing-gateway');
  await server.close();
});

test('AC-040: startup lock de processo morto é recuperado antes de iniciar @spec:AC-040', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-stale-lock-'));
  directories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  const paths = supervisorPaths(layout, identity.worktreeId);
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.startupLock, JSON.stringify({ pid: 999_999, createdAt: '2026-01-01T00:00:00.000Z' }));
  let server: Awaited<ReturnType<typeof startProjectSupervisor>> | undefined;

  const handle = await ensureProjectSupervisor({
    layout,
    identity,
    processExists: (pid) => pid === 5252,
    spawner: {
      async spawn() {
        server = await startProjectSupervisor({ layout, identity, pid: 5252 });
        return 5252;
      },
    },
  });

  expect(handle.manifest.pid).toBe(5252);
  expect(handle.reused).toBe(false);
  await handle.client.close();
  await server?.close();
});
