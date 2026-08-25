import { randomUUID } from 'node:crypto';
import { access, chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
    await rename(temporary, resolved);
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
    await rename(backup, target);
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
  if (hadTarget) await rename(target, backup);
  try {
    await rename(staged, target);
  } catch (error) {
    if (hadTarget && await exists(backup)) await rename(backup, target);
    throw error;
  }
  transaction.addRollback(async () => {
    await rm(target, { recursive: true, force: true });
    if (hadTarget && await exists(backup)) await rename(backup, target);
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
