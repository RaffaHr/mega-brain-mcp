import { randomUUID } from 'node:crypto';
import { access, chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createLocalLogger, type LocalLogger } from '../observability/logger.js';

export class RuntimeTransaction {
  readonly #rollbacks: Array<() => Promise<void>> = [];
  readonly #commits: Array<() => Promise<void>> = [];
  #finished = false;

  addRollback(rollback: () => Promise<void>): void {
    if (this.#finished) throw new Error('Runtime transaction is already finished');
    this.#rollbacks.push(rollback);
  }

  addCommit(commit: () => Promise<void>): void {
    if (this.#finished) throw new Error('Runtime transaction is already finished');
    this.#commits.push(commit);
  }

  async commit(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    this.#rollbacks.length = 0;
    const commits = this.#commits.splice(0);
    await Promise.allSettled(commits.map((commit) => commit()));
  }

  async rollback(): Promise<void> {
    if (this.#finished) return;
    const errors: unknown[] = [];
    for (const rollback of this.#rollbacks.reverse()) {
      try { await rollback(); } catch (error) { errors.push(error); }
    }
    this.#finished = true;
    this.#commits.length = 0;
    if (errors.length > 0) throw new AggregateError(errors, 'Runtime rollback was incomplete');
  }
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

/**
 * Clears read-only attributes so a later removal or rename can succeed.
 *
 * Every failure is reported instead of discarded: a refused `chmod` is the
 * usual reason the subsequent `rm` fails, and without the record the removal
 * error carries no hint about its cause. Clearing attributes is still
 * best-effort, so a failure never aborts the walk. The logger is threaded
 * through the recursion so one instance serves the whole tree, and the base
 * name travels beside the full path because redaction hides long absolute
 * paths from the record.
 */
export async function stripReadOnlyAttributes(targetPath: string, logger: LocalLogger = createLocalLogger()): Promise<void> {
  const resolved = path.resolve(targetPath);
  const report = (error: unknown): void => logger.log('debug', 'runtime: could not clear read-only attributes', {
    path: resolved,
    basename: path.basename(resolved),
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    const metadata = await lstat(resolved);
    if (metadata.isSymbolicLink()) return;
    await chmod(resolved, metadata.isDirectory() ? (metadata.mode & 0o777) | 0o777 : (metadata.mode & 0o777) | 0o666).catch(report);
    if (metadata.isDirectory()) {
      const entries = await readdir(resolved).catch((error: unknown) => { report(error); return [] as string[]; });
      for (const entry of entries) {
        await stripReadOnlyAttributes(path.join(resolved, entry), logger);
      }
    }
  } catch (error) {
    report(error);
  }
}

function retryableFilesystemError(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (platform === 'win32' || platform === 'linux' || platform === 'darwin')
    && ['EBUSY', 'EACCES', 'EPERM', 'ENOTEMPTY'].includes(code ?? '');
}

export async function retryFilesystemOperation<T>(
  operation: () => Promise<T>,
  label: string,
  options: { timeoutMs?: number; intervalMs?: number; platform?: NodeJS.Platform; targetPath?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  let intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let attempt = 0;

  do {
    try {
      return await operation();
    } catch (error) {
      if (!retryableFilesystemError(error, options.platform)) throw error;
      lastError = error;
      attempt += 1;
      if (options.targetPath && attempt % 3 === 0) {
        await stripReadOnlyAttributes(options.targetPath).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      intervalMs = Math.min(intervalMs * 1.5, 500);
    }
  } while (Date.now() < deadline);

  throw new Error(`${label} failed because Windows still has a handle open on the runtime path: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function retryRename(from: string, to: string, label: string, options: { timeoutMs?: number } = {}): Promise<void> {
  await stripReadOnlyAttributes(from).catch(() => undefined);
  await retryFilesystemOperation(() => rename(from, to), label, { targetPath: from, ...options });
}

export async function snapshotFile(transaction: RuntimeTransaction, target: string): Promise<void> {
  const resolved = path.resolve(target);
  let original: { content: Buffer; mode: number } | null = null;
  try {
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw new Error(`Transaction snapshot target is not a file: ${resolved}`);
    original = { content: await readFile(resolved), mode: metadata.mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  transaction.addRollback(async () => {
    if (!original) {
      await rm(resolved, { force: true });
      return;
    }
    await mkdir(path.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.${randomUUID()}.rollback`;
    await writeFile(temporary, original.content, { flag: 'wx', mode: original.mode });
    await rm(resolved, { force: true });
    await retryRename(temporary, resolved, 'Restoring transaction snapshot');
    if (process.platform !== 'win32') await chmod(resolved, original.mode);
  });
}

export async function snapshotPath(transaction: RuntimeTransaction, targetPath: string): Promise<void> {
  const target = path.resolve(targetPath);
  if (!(await exists(target))) {
    transaction.addRollback(() => rm(target, { recursive: true, force: true }));
    return;
  }
  const backup = `${target}.transaction-snapshot-${randomUUID()}`;
  await cp(target, backup, { recursive: true, force: false, errorOnExist: true });
  transaction.addRollback(async () => {
    await rm(target, { recursive: true, force: true });
    await retryRename(backup, target, 'Restoring transaction path snapshot');
  });
  transaction.addCommit(() => rm(backup, { recursive: true, force: true }));
}

export async function swapStagedPath(
  transaction: RuntimeTransaction,
  stagedPath: string,
  targetPath: string,
): Promise<void> {
  const staged = path.resolve(stagedPath);
  const target = path.resolve(targetPath);
  if (staged === target) throw new Error('Staged and target paths must differ');
  await mkdir(path.dirname(target), { recursive: true });
  const backup = `${target}.transaction-backup-${randomUUID()}`;
  const hadTarget = await exists(target);
  if (hadTarget) {
    await stripReadOnlyAttributes(target).catch(() => undefined);
    await retryRename(target, backup, 'Backing up current runtime');
  }
  try {
    await retryRename(staged, target, 'Activating staged runtime');
  } catch (error) {
    if (hadTarget && await exists(backup)) await retryRename(backup, target, 'Restoring current runtime after activation failure');
    throw error;
  }
  transaction.addRollback(async () => {
    await rm(target, { recursive: true, force: true });
    if (hadTarget && await exists(backup)) await retryRename(backup, target, 'Rolling back current runtime');
  });
  transaction.addCommit(async () => {
    if (hadTarget) await rm(backup, { recursive: true, force: true });
  });
}

export async function withRuntimeTransaction<T>(operation: (transaction: RuntimeTransaction) => Promise<T>): Promise<T> {
  const transaction = new RuntimeTransaction();
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try { await transaction.rollback(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Operation and rollback both failed');
    }
    throw error;
  }
}
