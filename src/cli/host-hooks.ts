import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { installClaudeHooks } from '../hooks/hosts/claude.js';
import { installCodexHooks, type HostHookConfig } from '../hooks/hosts/codex.js';

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
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
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
}): Promise<void> {
  await mkdir(input.backupDir, { recursive: true });
  for (const host of input.hosts) {
    const target = hostTarget(input.root, host);
    const backupPath = path.join(input.backupDir, `${host}.json`);
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

export async function restoreHostHookFiles(backupDir: string, hosts: SupportedHost[]): Promise<void> {
  for (const host of hosts) {
    const backupPath = path.join(backupDir, `${host}.json`);
    let backup: HostFileBackup;
    try { backup = JSON.parse(await readFile(backupPath, 'utf8')) as HostFileBackup; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (backup.existed) await atomicWrite(backup.target, backup.content);
    else await rm(backup.target, { force: true });
  }
}

export function parseHosts(value: string | undefined): SupportedHost[] {
  const hosts = (value ?? 'codex,claude').split(',').map((host) => host.trim()).filter(Boolean);
  if (hosts.some((host) => host !== 'codex' && host !== 'claude')) throw new Error('Supported hosts are codex and claude');
  return [...new Set(hosts)] as SupportedHost[];
}
