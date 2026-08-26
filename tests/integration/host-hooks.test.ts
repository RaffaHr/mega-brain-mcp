import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { dispatchHook } from '../../src/hooks/dispatcher.js';
import { normalizeHookEvent } from '../../src/hooks/events.js';
import { installClaudeHooks, uninstallClaudeHooks } from '../../src/hooks/hosts/claude.js';
import { installCodexHooks, uninstallCodexHooks } from '../../src/hooks/hosts/codex.js';
import { DurableHookQueue } from '../../src/hooks/queue.js';
import { installHostHookFiles, restoreHostHookFiles } from '../../src/cli/host-hooks.js';
import { expandHostSelection } from '../../src/cli/host-selection.js';

describe('host hook dispatcher', () => {
  test('AC-061: seleção de host cobre Codex, Claude e ambos @spec:AC-061', () => {
    expect(expandHostSelection('codex')).toEqual(['codex']);
    expect(expandHostSelection('claude')).toEqual(['claude']);
    expect(expandHostSelection('both')).toEqual(['codex', 'claude']);
  });

  test('normaliza o subconjunto Codex e os 12 eventos Claude com chave idempotente', () => {
    const payload = { session_id: 's1', tool_use_id: 't1' };
    expect(normalizeHookEvent('codex', 'PostToolUse', payload).event).toBe('tool_succeeded');
    expect(normalizeHookEvent('claude', 'PostToolUseFailure', payload).event).toBe('tool_failed');
    expect(normalizeHookEvent('codex', 'PostToolUse', payload).key).toBe(normalizeHookEvent('codex', 'PostToolUse', payload).key);
  });

  test('AC-018: instalação e remoção preservam hooks existentes @spec:AC-018', () => {
    const original = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'third-party' }] }] }, custom: true };
    const codex = installCodexHooks(original, 'mega-brain hook codex');
    const claude = installClaudeHooks(original, 'mega-brain hook claude');
    expect(codex.config.hooks?.SessionStart).toHaveLength(2);
    expect(claude.config.hooks?.SessionStart).toHaveLength(2);
    expect(uninstallCodexHooks(codex)).toEqual(original);
    expect(uninstallClaudeHooks(claude)).toEqual(original);
    expect(original.hooks.SessionStart).toHaveLength(1);
  });

  test('AC-019: falha de hook não bloqueia o trabalho @spec:AC-019', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-hooks-'));
    const queue = new DurableHookQueue(join(root, 'queue.json'));
    const result = await dispatchHook('claude', 'PostToolUse', { session_id: 's1', token: 'secret' }, {
      queue,
      redact: (payload) => ({ ...payload, token: '[REDACTED]' }),
      capture: async () => { throw new Error('AgentMemory offline'); },
      updateGraph: async () => undefined,
    });
    expect(result).toEqual({ continue: true, queued: true, duplicate: false });
    expect(await queue.pending()).toEqual([
      expect.objectContaining({ status: 'pending', event: expect.objectContaining({ payload: { session_id: 's1', token: '[REDACTED]' } }) }),
    ]);
  });

  test('P-006: hooks preservam integrações e falham de forma aberta @principle:P-006', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-hooks-'));
    const queue = new DurableHookQueue(join(root, 'queue.json'));
    const capture = vi.fn(async () => undefined);
    const dependencies = { queue, redact: (value: Record<string, unknown>) => value, capture, updateGraph: async () => undefined };
    const payload = { session_id: 's1', idempotencyKey: 'same-event' };
    expect((await dispatchHook('codex', 'Stop', payload, dependencies)).continue).toBe(true);
    expect(await dispatchHook('codex', 'Stop', payload, dependencies)).toEqual({ continue: true, queued: false, duplicate: true });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test('arquivos de host são mesclados e restaurados byte a byte', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-host-files-'));
    const codexDir = join(root, '.codex');
    await mkdir(codexDir, { recursive: true });
    const target = join(codexDir, 'hooks.json');
    const original = '{\n  "custom": true,\n  "hooks": {}\n}\n';
    await writeFile(target, original, 'utf8');
    const backupDir = join(root, '.state', 'backups');
    await installHostHookFiles({ root, backupDir, hosts: ['codex', 'claude'] });
    expect(await readFile(target, 'utf8')).toContain('mega-brain hook host codex');
    expect(await readFile(join(root, '.claude', 'settings.local.json'), 'utf8')).toContain('mega-brain hook host claude');
    await restoreHostHookFiles(backupDir, ['codex', 'claude']);
    expect(await readFile(target, 'utf8')).toBe(original);
    await expect(readFile(join(root, '.claude', 'settings.local.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
