import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createLocalLogger, type LocalLogger } from '../observability/logger.js';
import { stripReadOnlyAttributes } from './transaction.js';

export interface PendingDeletesManifest {
  version: 1;
  paths: string[];
}

function pendingDeletesFile(dataDir: string): string {
  return path.join(dataDir, 'pending-deletes.json');
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

export async function loadPendingDeletes(dataDir: string): Promise<string[]> {
  const filePath = pendingDeletesFile(dataDir);
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as PendingDeletesManifest;
    return Array.isArray(parsed.paths) ? parsed.paths : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

export async function savePendingDeletes(dataDir: string, paths: string[]): Promise<void> {
  const filePath = pendingDeletesFile(dataDir);
  const uniquePaths = Array.from(new Set(paths.map((item) => path.resolve(item))));
  if (uniquePaths.length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const manifest: PendingDeletesManifest = { version: 1, paths: uniquePaths };
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function queuePendingDelete(dataDir: string, targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  const current = await loadPendingDeletes(dataDir);
  if (!current.includes(resolved)) {
    current.push(resolved);
    await savePendingDeletes(dataDir, current);
  }
}

export async function clearPendingDelete(dataDir: string, targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  const current = await loadPendingDeletes(dataDir);
  const filtered = current.filter((item) => item !== resolved);
  await savePendingDeletes(dataDir, filtered);
}

/**
 * Removes a directory, retrying once after a second attribute pass because a
 * handle released between the two tries is the common Windows case. Returning
 * `false` tells the caller to queue the path, and the reason for the final
 * failure is reported so a stuck path can be diagnosed.
 */
export async function safeRemoveDirectory(target: string, logger: LocalLogger = createLocalLogger()): Promise<boolean> {
  const resolved = path.resolve(target);
  if (!(await exists(resolved))) return true;

  await stripReadOnlyAttributes(resolved, logger);
  try {
    await rm(resolved, { recursive: true, force: true });
    return true;
  } catch {
    await stripReadOnlyAttributes(resolved, logger);
    try {
      await rm(resolved, { recursive: true, force: true });
      return true;
    } catch (error) {
      logger.log('debug', 'runtime: could not remove directory', {
        path: resolved,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export async function drainPendingDeletes(dataDir: string): Promise<{ purged: string[]; remaining: string[] }> {
  const queued = await loadPendingDeletes(dataDir);
  if (queued.length === 0) return { purged: [], remaining: [] };

  const purged: string[] = [];
  const remaining: string[] = [];

  for (const target of queued) {
    const removed = await safeRemoveDirectory(target);
    if (removed) {
      purged.push(target);
    } else {
      remaining.push(target);
    }
  }

  await savePendingDeletes(dataDir, remaining);
  return { purged, remaining };
}
