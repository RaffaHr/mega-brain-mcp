import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

export function supervisorPaths(layout: RuntimeLayout, worktreeId: string): SupervisorPaths {
  if (!/^[a-f0-9]{24}$/u.test(worktreeId)) throw new Error('Invalid supervisor worktree identity');
  const directory = path.join(layout.projectRoot, 'supervisor');
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    startupLock: path.join(directory, 'startup.lock'),
    ipcAddress: process.platform === 'win32'
      ? `\\\\.\\pipe\\mega-brain-${worktreeId}`
      : path.join(directory, 'supervisor.sock'),
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
