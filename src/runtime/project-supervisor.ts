import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';

import { createLocalLogger } from '../observability/logger.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { startSupervisorIpcServer, SupervisorIpcClient } from './ipc.js';
import { LeaseRegistry, type LeaseRegistryOptions } from './leases.js';
import type { RuntimeLayout } from './layout.js';
import {
  readSupervisorManifest,
  removeSupervisorManifest,
  supervisorPaths,
  SUPERVISOR_PROTOCOL_VERSION,
  writeSupervisorManifest,
  type SupervisorManifest,
} from './supervisor-manifest.js';

export interface SupervisorProcessSpawner {
  spawn(input: { identity: ProjectIdentity; layout: RuntimeLayout }): Promise<number>;
}

export const detachedSupervisorSpawner: SupervisorProcessSpawner = {
  async spawn({ identity }) {
    const entrypoint = process.argv[1];
    if (!entrypoint) throw new Error('Cannot locate the Mega Brain CLI entrypoint');
    const child = spawn(process.execPath, [entrypoint, 'supervisor', '--repo', identity.root], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (!child.pid) throw new Error('Supervisor process started without a pid');
    child.unref();
    return child.pid;
  },
};

export interface ProjectSupervisorServer {
  manifest: SupervisorManifest;
  leases: LeaseRegistry;
  closed: Promise<void>;
  checkIdle(): Promise<boolean>;
  close(): Promise<void>;
}

export async function startProjectSupervisor(input: {
  layout: RuntimeLayout;
  identity: ProjectIdentity;
  pid?: number;
  now?: () => number;
  leaseOptions?: Omit<LeaseRegistryOptions, 'now'>;
  onShutdown?: () => Promise<void> | void;
}): Promise<ProjectSupervisorServer> {
  assertLayoutIdentity(input.layout, input.identity);
  const pid = input.pid ?? process.pid;
  const now = input.now ?? Date.now;
  const paths = supervisorPaths(input.layout, input.identity.worktreeId);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const leases = new LeaseRegistry({ ...input.leaseOptions, now });
  const startedAt = new Date(now()).toISOString();
  const manifest: SupervisorManifest = {
    protocolVersion: SUPERVISOR_PROTOCOL_VERSION,
    worktreeId: input.identity.worktreeId,
    pid,
    ipcAddress: paths.ipcAddress,
    startedAt,
    updatedAt: startedAt,
  };
  let draining = false;
  const ipc = await startSupervisorIpcServer({
    address: paths.ipcAddress,
    handle(request) {
      if (request.worktreeId !== input.identity.worktreeId) throw new Error('Supervisor worktree identity mismatch');
      if (request.type !== 'status' && request.type !== 'drain' && !request.leaseId) throw new Error(`${request.type} requires leaseId`);
      if (request.type === 'acquire' && draining) throw new Error('Supervisor is draining and does not accept new leases');
      if (request.type === 'drain') draining = true;
      if (request.type === 'acquire') leases.acquire(request.leaseId!);
      if (request.type === 'heartbeat') leases.heartbeat(request.leaseId!);
      if (request.type === 'release') leases.release(request.leaseId!);
      return {
        ok: true,
        protocolVersion: SUPERVISOR_PROTOCOL_VERSION,
        worktreeId: input.identity.worktreeId,
        pid,
        leases: leases.activeIds(),
        draining,
      };
    },
  });
  try {
    await writeSupervisorManifest(input.layout, manifest);
  } catch (error) {
    await ipc.close();
    throw error;
  }

  let closed = false;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  let closing: Promise<void> | undefined;
  /**
   * Releases the endpoint and the manifest.
   *
   * `closedPromise` is settled in a `finally` because it is what the daemon
   * awaits before stopping the managed runtime: leaving it pending after a
   * failed release would strand the process with its backends still running.
   * The rejection itself keeps propagating to whoever awaits `close()`.
   */
  const close = async (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        await ipc.close();
        await removeSupervisorManifest(input.layout);
      } finally {
        resolveClosed();
      }
    })();
    return closing;
  };
  const checkIdle = async (): Promise<boolean> => {
    if (closed || !leases.shouldShutdown()) return false;
    try {
      await input.onShutdown?.();
    } finally {
      await close();
    }
    return true;
  };
  /**
   * Drives the idle shutdown without letting a failure become an unhandled
   * rejection, which Node turns into a fatal error and would kill the daemon.
   * The handler stays on this callsite instead of inside `checkIdle` so callers
   * that await it keep seeing the failure propagate.
   */
  const timer = setInterval(() => {
    if (closed) return;
    void checkIdle().catch((error: unknown) => createLocalLogger().log('warn', 'supervisor: idle shutdown failed', {
      project: input.identity.worktreeId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }, Math.min(1_000, Math.max(100, leases.shutdownGraceMs)));
  timer.unref();

  return { manifest, leases, closed: closedPromise, checkIdle, close };
}

export interface EnsureProjectSupervisorOptions {
  layout: RuntimeLayout;
  identity: ProjectIdentity;
  spawner?: SupervisorProcessSpawner;
  processExists?: (pid: number) => boolean | Promise<boolean>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ProjectSupervisorHandle {
  manifest: SupervisorManifest;
  client: SupervisorIpcClient;
  reused: boolean;
}

function assertLayoutIdentity(layout: RuntimeLayout, identity: ProjectIdentity): void {
  if (layout.projectRoot.split(/[\\/]/u).at(-1) !== identity.worktreeId) {
    throw new Error('Runtime layout does not match the project worktree identity');
  }
}

async function defaultProcessExists(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Tells a manifest that outlived its endpoint from a supervisor that is merely
 * unhealthy.
 *
 * The manifest is only written once the IPC server is listening, so a missing
 * endpoint (a reaped socket under the temporary directory, a released named
 * pipe) or a refused connection (the process was killed without unlinking, and
 * its pid was later reused) means the recorded supervisor is gone. Anything
 * else, an identity mismatch in particular, must still surface.
 */
function unreachableAddress(error: unknown): boolean {
  return ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '');
}

async function connectExisting(
  options: EnsureProjectSupervisorOptions,
): Promise<ProjectSupervisorHandle | null> {
  let manifest: SupervisorManifest;
  try { manifest = await readSupervisorManifest(options.layout); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (manifest.worktreeId !== options.identity.worktreeId) {
    throw new Error('Supervisor manifest worktree identity mismatch');
  }
  const processExists = options.processExists ?? defaultProcessExists;
  if (!(await processExists(manifest.pid))) {
    await removeSupervisorManifest(options.layout);
    return null;
  }
  const client = new SupervisorIpcClient(manifest);
  try {
    await client.status();
    return { manifest, client, reused: true };
  } catch (error) {
    if (unreachableAddress(error)) {
      await removeSupervisorManifest(options.layout);
      return null;
    }
    throw new Error(`Supervisor process ${manifest.pid} exists but readiness failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForSupervisor(options: EnsureProjectSupervisorOptions): Promise<ProjectSupervisorHandle> {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const existing = await connectExisting(options);
      if (existing) return existing;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 25));
  }
  throw new Error(`Supervisor did not become ready: ${lastError instanceof Error ? lastError.message : 'manifest unavailable'}`);
}

export async function ensureProjectSupervisor(
  options: EnsureProjectSupervisorOptions,
): Promise<ProjectSupervisorHandle> {
  assertLayoutIdentity(options.layout, options.identity);
  const existing = await connectExisting(options);
  if (existing) return existing;

  const paths = supervisorPaths(options.layout, options.identity.worktreeId);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  while (!lock) {
    try {
      const candidate = await open(paths.startupLock, 'wx', 0o600);
      try {
        await candidate.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
        lock = candidate;
      } catch (writeError) {
        await candidate.close();
        await rm(paths.startupLock, { force: true });
        throw writeError;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const raw = JSON.parse(await readFile(paths.startupLock, 'utf8')) as { pid?: unknown };
        if (typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0) {
          stale = !(await (options.processExists ?? defaultProcessExists)(raw.pid));
        }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      if (stale) {
        await rm(paths.startupLock, { force: true });
        continue;
      }
      return waitForSupervisor(options);
    }
  }

  try {
    const rechecked = await connectExisting(options);
    if (rechecked) return rechecked;
    await (options.spawner ?? detachedSupervisorSpawner).spawn({ identity: options.identity, layout: options.layout });
    const started = await waitForSupervisor(options);
    return { ...started, reused: false };
  } finally {
    await lock.close();
    await rm(paths.startupLock, { force: true });
  }
}
