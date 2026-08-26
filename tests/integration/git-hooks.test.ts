import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';

import type { GitRepository } from '../../src/adapters/git/repository.js';
import { installGitHookMultiplexer, restoreGitHooks } from '../../src/hooks/git/install.js';
import { renderHookMultiplexer } from '../../src/hooks/git/multiplexer.js';
import { handleGitEvent, HookEventLedger } from '../../src/lifecycle/commit-handler.js';
import { openProvenanceDatabase } from '../../src/provenance/database.js';

test('AC-017: eventos de host e Git são normalizados e idempotentes @spec:AC-017', async () => {
  const database = openProvenanceDatabase(':memory:');
  const updateGraph = vi.fn(async () => undefined);
  const linkSession = vi.fn(async () => undefined);
  const markPossiblyStale = vi.fn(async () => undefined);
  const dependencies = {
    ledger: new HookEventLedger(database),
    changedPaths: async () => ['src/payment.ts'],
    updateGraph,
    linkSession,
    revalidation: {
      findBlastRadius: async () => ['src/checkout.ts'],
      findAffectedMemoryIds: async (paths: string[]) => paths.includes('src/payment.ts') ? ['direct'] : ['related'],
      markPossiblyStale,
    },
  };
  const input = { key: 'post-commit:abc', event: 'post-commit' as const, commitHash: 'abc' };
  const first = await handleGitEvent(input, dependencies);
  const duplicate = await handleGitEvent(input, dependencies);
  expect(first).toMatchObject({ duplicate: false, revalidation: { invalidatedMemoryIds: ['direct', 'related'] } });
  expect(duplicate).toEqual({ duplicate: true });
  expect(updateGraph).toHaveBeenCalledTimes(1);
  expect(linkSession).toHaveBeenCalledTimes(1);
  expect(markPossiblyStale).toHaveBeenCalledWith('direct', 'evidence_changed', 'abc');
  expect(markPossiblyStale).toHaveBeenCalledWith('related', 'related_symbol_changed', 'abc');
  database.close();
});

test('multiplexer preserva o hook anterior e ignora falha do Mega Brain', () => {
  const script = renderHookMultiplexer({
    event: 'post-commit',
    previousHook: "/repo/.git/hooks'old/post-commit",
    megaBrainCommand: ['node', '/runtime/mega-brain.js'],
  });
  expect(script).toContain('previous_status=$?');
  expect(script).toContain('|| true');
  expect(script).toContain(') &');
  expect(script).toContain('exit "$previous_status"');
  expect(script).toContain("'\"'\"'");
});

test('instalação Git é idempotente e restaura core.hooksPath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mega-brain-git-hooks-'));
  let hooksPath: string | null = '.third-party-hooks';
  const run = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'config --local --get core.hooksPath') {
      if (hooksPath === null) throw new Error('unset');
      return `${hooksPath}\n`;
    }
    if (args[0] === 'config' && args[2] === 'core.hooksPath' && args[3]) { hooksPath = args[3]; return '' ; }
    if (args.join(' ') === 'config --local --unset core.hooksPath') { hooksPath = null; return ''; }
    if (args.join(' ') === 'rev-parse --absolute-git-dir') return `${join(root, '.git')}\n`;
    throw new Error(`Unexpected Git args: ${args.join(' ')}`);
  });
  const repository = { root, run } as unknown as GitRepository;
  const managedHooksPath = join(root, '.mega-brain-hooks');
  await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] });
  await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] });
  expect(await readFile(join(managedHooksPath, 'post-commit'), 'utf8')).toContain('.third-party-hooks');
  await restoreGitHooks(repository, managedHooksPath);
  expect(hooksPath).toBe('.third-party-hooks');
});

test('instalação Git corrige backup que aponta para o próprio hooksPath gerenciado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mega-brain-git-hooks-self-'));
  const managedHooksPath = join(root, '.mega-brain-hooks');
  let hooksPath: string | null = managedHooksPath;
  const run = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'config --local --get core.hooksPath') {
      if (hooksPath === null) throw new Error('unset');
      return `${hooksPath}\n`;
    }
    if (args[0] === 'config' && args[2] === 'core.hooksPath' && args[3]) { hooksPath = args[3]; return ''; }
    if (args.join(' ') === 'rev-parse --absolute-git-dir') return `${join(root, '.git')}\n`;
    throw new Error(`Unexpected Git args: ${args.join(' ')}`);
  });
  const repository = { root, run } as unknown as GitRepository;
  await mkdir(managedHooksPath, { recursive: true });
  await writeFile(join(managedHooksPath, 'installation.json'), JSON.stringify({
    previousHooksPath: managedHooksPath,
    previousResolvedHooksPath: managedHooksPath,
  }), 'utf8');

  await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] });

  const script = await readFile(join(managedHooksPath, 'post-commit'), 'utf8');
  const backup = JSON.parse(await readFile(join(managedHooksPath, 'installation.json'), 'utf8')) as { previousHooksPath: string | null; previousResolvedHooksPath: string };
  expect(backup.previousHooksPath).toBeNull();
  expect(backup.previousResolvedHooksPath).toBe(join(root, '.git/hooks'));
  expect(script).not.toContain(`${managedHooksPath}\\post-commit`);
  expect(script).toContain(join(root, '.git/hooks', 'post-commit'));
});

test('instalação Git não encadeia hooks gerenciados por instalação anterior do Mega Brain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mega-brain-git-hooks-previous-managed-'));
  const previousManagedHooksPath = join(root, '.mega-brain-old-hooks');
  const managedHooksPath = join(root, '.mega-brain-new-hooks');
  let hooksPath: string | null = previousManagedHooksPath;
  const run = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'config --local --get core.hooksPath') {
      if (hooksPath === null) throw new Error('unset');
      return `${hooksPath}\n`;
    }
    if (args[0] === 'config' && args[2] === 'core.hooksPath' && args[3]) { hooksPath = args[3]; return ''; }
    if (args.join(' ') === 'rev-parse --absolute-git-dir') return `${join(root, '.git')}\n`;
    throw new Error(`Unexpected Git args: ${args.join(' ')}`);
  });
  await mkdir(previousManagedHooksPath, { recursive: true });
  await writeFile(join(previousManagedHooksPath, 'installation.json'), JSON.stringify({
    previousHooksPath: null,
    previousResolvedHooksPath: join(root, '.git/hooks'),
  }), 'utf8');
  const repository = { root, run } as unknown as GitRepository;

  await installGitHookMultiplexer({ repository, managedHooksPath, megaBrainCommand: ['mega-brain'] });

  const script = await readFile(join(managedHooksPath, 'post-commit'), 'utf8');
  expect(script).not.toContain(previousManagedHooksPath);
  expect(script).toContain(join(root, '.git/hooks', 'post-commit'));
});
