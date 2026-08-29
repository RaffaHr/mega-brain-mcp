import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type { RuntimeLayout } from './layout.js';

export const SUPERVISOR_PROTOCOL_VERSION = 1 as const;

export const supervisorManifestSchema = z.object({
  protocolVersion: z.literal(SUPERVISOR_PROTOCOL_VERSION),
  worktreeId: z.string().regex(/^[a-f0-9]{24}$/u),
  pid: z.number().int().positive(),
  ipcAddress: z.string().min(1),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type SupervisorManifest = z.infer<typeof supervisorManifestSchema>;

export interface SupervisorPaths {
  directory: string;
  manifest: string;
  startupLock: string;
  ipcAddress: string;
}

const POSIX_SOCKET_PATH_LIMIT = process.platform === 'darwin' ? 104 : 107;

/**
 * Resolves the Unix domain socket address of a supervisor.
 *
 * Binding fails with EINVAL when the address does not fit the platform
 * `sun_path` buffer, so a project whose runtime directory is deep falls back to
 * a dedicated directory under the system temporary folder. The fallback name is
 * derived from the supervisor directory instead of the worktree identity so two
 * data directories holding the same project never collide, and the directory is
 * exclusive so `startSupervisorIpcServer` can restrict it to the current user.
 */
function posixIpcAddress(directory: string): string {
  const preferred = path.join(directory, 'supervisor.sock');
  if (Buffer.byteLength(preferred) <= POSIX_SOCKET_PATH_LIMIT) return preferred;
  const digest = createHash('sha256').update(directory).digest('hex').slice(0, 16);
  const fallback = path.join(tmpdir(), `mega-brain-${digest}`, 's.sock');
  if (Buffer.byteLength(fallback) > POSIX_SOCKET_PATH_LIMIT) {
    throw new Error(`Supervisor socket address exceeds the ${POSIX_SOCKET_PATH_LIMIT} byte platform limit even under the temporary directory; point TMPDIR at a shorter path`);
  }
  return fallback;
}

export function supervisorPaths(layout: RuntimeLayout, worktreeId: string): SupervisorPaths {
  if (!/^[a-f0-9]{24}$/u.test(worktreeId)) throw new Error('Invalid supervisor worktree identity');
  const directory = path.join(layout.projectRoot, 'supervisor');
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    startupLock: path.join(directory, 'startup.lock'),
    ipcAddress: process.platform === 'win32'
      ? `\\\\.\\pipe\\mega-brain-${worktreeId}`
      : posixIpcAddress(directory),
  };
}

function manifestPath(layout: RuntimeLayout): string {
  return path.join(layout.projectRoot, 'supervisor', 'manifest.json');
}

export async function writeSupervisorManifest(
  layout: RuntimeLayout,
  manifest: SupervisorManifest,
): Promise<void> {
  const parsed = supervisorManifestSchema.parse(manifest);
  const filePath = manifestPath(layout);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  await rename(temporary, filePath);
  if (process.platform !== 'win32') await chmod(filePath, 0o600);
}

export async function readSupervisorManifest(layout: RuntimeLayout): Promise<SupervisorManifest> {
  return supervisorManifestSchema.parse(JSON.parse(await readFile(manifestPath(layout), 'utf8')));
}

export async function removeSupervisorManifest(layout: RuntimeLayout): Promise<void> {
  await rm(manifestPath(layout), { force: true });
}
