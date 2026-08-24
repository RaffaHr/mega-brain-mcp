import { expect, test } from 'vitest';

import { deriveProjectIdentity, normalizeRemote } from '../../src/projects/identity.js';
import { ProjectRegistry } from '../../src/projects/registry.js';

test('project identity separates repository, checkout and worktree without retaining credentials', () => {
  const main = deriveProjectIdentity({
    root: 'C:\\code\\project',
    gitDir: '.git',
    commonGitDir: '.git',
    remote: 'https://token@example.com/Org/Repo.git',
  });
  const worktree = deriveProjectIdentity({
    root: 'C:\\code\\project-feature',
    gitDir: 'C:\\code\\project\\.git\\worktrees\\feature',
    commonGitDir: 'C:\\code\\project\\.git',
    remote: 'git@example.com:Org/Repo.git',
  });

  expect(normalizeRemote('https://token@example.com/Org/Repo.git')).toBe('example.com/Org/Repo');
  expect(main.repositoryId).toBe(worktree.repositoryId);
  expect(main.checkoutId).not.toBe(worktree.checkoutId);
  expect(main.worktreeId).not.toBe(worktree.worktreeId);
  expect(main.remote).not.toContain('token');
});

test('project aliases cannot be rebound to a different worktree', () => {
  const first = deriveProjectIdentity({ root: 'C:\\one', gitDir: '.git', commonGitDir: '.git' });
  const second = deriveProjectIdentity({ root: 'C:\\two', gitDir: '.git', commonGitDir: '.git' });
  const registry = new ProjectRegistry([{ alias: 'shop', identity: first }]);

  expect(registry.resolve('shop')).toEqual(first);
  expect(() => registry.register('shop', second)).toThrow(/another worktree/);
  expect(() => registry.register('../escape', first)).toThrow(/Invalid project alias/);
});
