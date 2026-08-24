import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test } from 'vitest';

import { committedBlobHash } from '../../src/adapters/git/blobs.js';
import { gitHistory } from '../../src/adapters/git/history.js';
import { GitRepository } from '../../src/adapters/git/repository.js';

const run = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

test('reads HEAD, tracked blobs, status and immutable history from Git', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-repository-'));
  directories.push(root);
  await run('git', ['init', root]);
  await writeFile(path.join(root, 'app.ts'), 'export const answer = 42;\n', 'utf8');
  await run('git', ['-C', root, 'add', 'app.ts']);
  await run('git', ['-C', root, '-c', 'user.name=Mega Brain Tests', '-c', 'user.email=tests@example.invalid', 'commit', '-m', 'initial']);

  const repository = await GitRepository.discover(root);
  const head = await repository.head();
  const history = await gitHistory(repository, 5);

  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(await repository.trackedFiles()).toEqual(['app.ts']);
  expect(await committedBlobHash(repository, 'app.ts')).toMatch(/^[a-f0-9]{40}$/);
  expect(history[0]).toMatchObject({ hash: head, subject: 'initial' });
  expect(await repository.status()).toEqual([]);
}, 20_000);
