import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { installClaudeHooks } from '../hooks/hosts/claude.js';
import { installCodexHooks, type HostHookConfig } from '../hooks/hosts/codex.js';
import { snapshotFile, type RuntimeTransaction } from '../runtime/transaction.js';

export type SupportedHost = 'codex' | 'claude';

interface HostFileBackup {
  existed: boolean;
  content: string;
  target: string;
}

function hostTarget(root: string, host: SupportedHost): string {
  return host === 'codex'
    ? path.join(root, '.codex', 'hooks.json')
    : path.join(root, '.claude', 'settings.local.json');
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasMegaBrainCommand(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const command = value.command;
  return typeof command === 'string' && /\bmega-brain\b.*\bhook\b.*\bhost\b/u.test(command);
}

function isMegaBrainHookRegistration(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value._megaBrain === true) return true;
  const hooks = value.hooks;
  return Array.isArray(hooks) && hooks.some(hasMegaBrainCommand);
}

function removeMegaBrainHostHooks(content: string): string {
  const config = content.trim() ? JSON.parse(content) as HostHookConfig : {};
  if (!isRecord(config.hooks)) return `${JSON.stringify(config, null, 2)}\n`;
  const hooks: Record<string, unknown> = { ...config.hooks };
  for (const [event, registrations] of Object.entries(hooks)) {
    if (!Array.isArray(registrations)) continue;
    const kept = registrations.filter((entry) => !isMegaBrainHookRegistration(entry));
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length > 0) config.hooks = hooks as Record<string, Array<Record<string, unknown>>>;
  else delete config.hooks;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function normalizedRestoreHostHookInput(
  inputOrBackupDir: string | { root?: string; backupDir: string; hosts: SupportedHost[] },
  maybeHosts?: SupportedHost[],
): { root?: string; backupDir: string; hosts: SupportedHost[] } {
  return typeof inputOrBackupDir === 'string'
    ? { backupDir: inputOrBackupDir, hosts: maybeHosts ?? [] }
    : inputOrBackupDir;
}

async function readOptional(target: string): Promise<{ existed: boolean; content: string }> {
  try { return { existed: true, content: await readFile(target, 'utf8') }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { existed: false, content: '' };
    throw error;
  }
}

export async function installHostHookFiles(input: {
  root: string;
  backupDir: string;
  hosts: SupportedHost[];
  command?: string;
  transaction?: RuntimeTransaction;
}): Promise<void> {
  await mkdir(input.backupDir, { recursive: true });
  for (const host of input.hosts) {
    const target = hostTarget(input.root, host);
    const backupPath = path.join(input.backupDir, `${host}.json`);
    if (input.transaction) {
      await snapshotFile(input.transaction, target);
      await snapshotFile(input.transaction, backupPath);
    }
    let backup: HostFileBackup;
    try { backup = JSON.parse(await readFile(backupPath, 'utf8')) as HostFileBackup; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const original = await readOptional(target);
      backup = { ...original, target };
      await atomicWrite(backupPath, JSON.stringify(backup));
    }
    const current = await readOptional(target);
    const parsed = current.content ? JSON.parse(current.content) as HostHookConfig : {};
    const command = input.command ?? `mega-brain hook host ${host}`;
    const installation = host === 'codex' ? installCodexHooks(parsed, command) : installClaudeHooks(parsed, command);
    await atomicWrite(target, `${JSON.stringify(installation.config, null, 2)}\n`);
  }
}

export async function restoreHostHookFiles(backupDir: string, hosts: SupportedHost[]): Promise<void>;
export async function restoreHostHookFiles(input: { root?: string; backupDir: string; hosts: SupportedHost[] }): Promise<void>;
export async function restoreHostHookFiles(
  inputOrBackupDir: string | { root?: string; backupDir: string; hosts: SupportedHost[] },
  maybeHosts?: SupportedHost[],
): Promise<void> {
  if (typeof inputOrBackupDir === 'string') {
    for (const host of maybeHosts ?? []) {
      const backupPath = path.join(inputOrBackupDir, `${host}.json`);
      let backup: HostFileBackup;
      try { backup = JSON.parse(await readFile(backupPath, 'utf8')) as HostFileBackup; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (backup.existed) await atomicWrite(backup.target, backup.content);
      else await rm(backup.target, { force: true });
    }
    return;
  }
  const input = normalizedRestoreHostHookInput(inputOrBackupDir, maybeHosts);
  for (const host of input.hosts) {
    const backupPath = path.join(input.backupDir, `${host}.json`);
    let backup: HostFileBackup | undefined;
    try { backup = JSON.parse(await readFile(backupPath, 'utf8')) as HostFileBackup; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const target = backup?.target ?? (input.root ? hostTarget(input.root, host) : undefined);
    if (!target) continue;
    const current = await readOptional(target);
    if (!current.existed) continue;
    await atomicWrite(target, removeMegaBrainHostHooks(current.content));
  }
}
