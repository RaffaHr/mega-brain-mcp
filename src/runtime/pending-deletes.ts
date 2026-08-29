import { access, chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

async function stripReadOnlyRecursive(target: string): Promise<void> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return;
    await chmod(target, stats.isDirectory() ? (stats.mode & 0o777) | 0o777 : (stats.mode & 0o777) | 0o666).catch(() => undefined);
    if (stats.isDirectory()) {
      const entries = await readdir(target).catch(() => []);
      for (const entry of entries) {
        await stripReadOnlyRecursive(path.join(target, entry)).catch(() => undefined);
      }
    }
  } catch {
    // ignore
  }
}

export async function safeRemoveDirectory(target: string): Promise<boolean> {
  const resolved = path.resolve(target);
  if (!(await exists(resolved))) return true;

  await stripReadOnlyRecursive(resolved);
  try {
    await rm(resolved, { recursive: true, force: true });
    return true;
  } catch {
    // Retry once after additional chmod
    await stripReadOnlyRecursive(resolved);
    try {
      await rm(resolved, { recursive: true, force: true });
      return true;
    } catch {
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
