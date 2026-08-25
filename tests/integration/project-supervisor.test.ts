import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { deriveProjectIdentity } from '../../src/projects/identity.js';
import {
  ensureProjectSupervisor,
  startProjectSupervisor,
  type SupervisorProcessSpawner,
} from '../../src/runtime/project-supervisor.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { readSupervisorManifest, supervisorManifestSchema, supervisorPaths } from '../../src/runtime/supervisor-manifest.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

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
  await expect(readSupervisorManifest(layout)).rejects.toMatchObject({ code: 'ENOENT' });
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
