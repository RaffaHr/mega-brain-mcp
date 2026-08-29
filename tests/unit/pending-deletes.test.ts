import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  clearPendingDelete,
  drainPendingDeletes,
  loadPendingDeletes,
  queuePendingDelete,
} from '../../src/runtime/pending-deletes.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

describe('Pending Delete Queue', () => {
  test('queues locked paths and persists them in pending-deletes.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pending-deletes-'));
    temporaryDirectories.push(root);
    const targetA = path.join(root, 'locked-a');
    const targetB = path.join(root, 'locked-b');

    await queuePendingDelete(root, targetA);
    await queuePendingDelete(root, targetB);

    const queued = await loadPendingDeletes(root);
    expect(queued).toContain(path.resolve(targetA));
    expect(queued).toContain(path.resolve(targetB));
  });

  test('drainPendingDeletes purges existing folders and removes them from queue', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pending-deletes-drain-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'deletable-folder');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'file.txt'), 'content');

    await queuePendingDelete(root, target);
    const result = await drainPendingDeletes(root);

    expect(result.purged).toContain(path.resolve(target));
    expect(result.remaining).toEqual([]);
    const remainingQueue = await loadPendingDeletes(root);
    expect(remainingQueue).toEqual([]);
  });

  test('tolerates already-deleted files without error during drain', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pending-deletes-empty-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'non-existent');

    await queuePendingDelete(root, target);
    const result = await drainPendingDeletes(root);

    expect(result.purged).toContain(path.resolve(target));
    expect(result.remaining).toEqual([]);
  });
});