import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';

import { GitRepository } from '../../src/adapters/git/repository.js';

const run = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('git status rename parsing', () => {
  test('AC-069: suporte a rename no parser de git status @spec:AC-069', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-git-rename-'));
    directories.push(root);

    await run('git', ['init', root]);
    await writeFile(path.join(root, 'old-name.ts'), 'export const hello = "world";\n', 'utf8');
    await writeFile(path.join(root, 'stay.ts'), 'export const unchanged = true;\n', 'utf8');
    await run('git', ['-C', root, 'add', '.']);
    await run('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'initial']);

    // Rename old-name.ts -> new-name.ts
    await run('git', ['-C', root, 'mv', 'old-name.ts', 'new-name.ts']);
    // Modify stay.ts
    await writeFile(path.join(root, 'stay.ts'), 'export const unchanged = false;\n', 'utf8');

    const repository = await GitRepository.discover(root);
    const status = await repository.status();

    // Verify rename entry
    const renameEntry = status.find((e) => e.path === 'new-name.ts');
    expect(renameEntry).toBeDefined();
    expect(renameEntry?.index).toBe('R');
    expect(renameEntry?.origPath).toBe('old-name.ts');

    // Verify modified entry is not corrupted by rename's second token
    const modEntry = status.find((e) => e.path === 'stay.ts');
    expect(modEntry).toBeDefined();
    expect(modEntry?.worktree).toBe('M');
  });
});
