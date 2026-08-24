import { mkdtemp, readFile } from 'node:fs/promises';
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
    if (args.join(' ') === 'rev-parse --git-path hooks') return '.git/hooks\n';
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
