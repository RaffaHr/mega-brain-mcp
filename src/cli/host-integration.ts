import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SupportedHost } from './host-hooks.js';

interface HostFileBackup {
  existed: boolean;
  content: string;
  target: string;
}

const CODEX_BLOCK_START = '# >>> mega-brain mcp >>>';
const CODEX_BLOCK_END = '# <<< mega-brain mcp <<<';

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

function targetFor(root: string, host: SupportedHost): string {
  return host === 'codex' ? path.join(root, '.codex', 'config.toml') : path.join(root, '.mcp.json');
}

function removeCodexMegaBrainSection(content: string): string {
  const withoutManagedBlock = content.replace(
    new RegExp(`(?:^|\\r?\\n)${CODEX_BLOCK_START.replaceAll('>', '\\>')}[\\s\\S]*?${CODEX_BLOCK_END.replaceAll('<', '\\<')}(?=\\r?\\n|$)`, 'g'),
    '',
  );
  const lines = withoutManagedBlock.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)]$/)?.[1];
    if (header !== undefined) {
      const normalized = header.replaceAll('"', '');
      skipping = normalized === 'mcp_servers.mega-brain';
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

export function mergeCodexMcpConfig(existing: string, endpoint: string): string {
  const base = removeCodexMegaBrainSection(existing);
  const block = `${CODEX_BLOCK_START}\n[mcp_servers.mega-brain]\nurl = ${JSON.stringify(endpoint)}\n${CODEX_BLOCK_END}`;
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

export function mergeClaudeMcpConfig(existing: string, endpoint: string): string {
  const config = existing.trim() ? JSON.parse(existing) as Record<string, unknown> : {};
  const current = config.mcpServers;
  if (current !== undefined && (current === null || Array.isArray(current) || typeof current !== 'object')) {
    throw new Error('Claude .mcp.json mcpServers must be an object');
  }
  config.mcpServers = {
    ...((current ?? {}) as Record<string, unknown>),
    'mega-brain': { type: 'http', url: endpoint },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function installHostMcpFiles(input: {
  root: string;
  backupDir: string;
  hosts: SupportedHost[];
  endpoint: string;
}): Promise<void> {
  const endpoint = new URL(input.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('MCP endpoint must use HTTP or HTTPS');
  await mkdir(input.backupDir, { recursive: true });
  for (const host of input.hosts) {
    const target = targetFor(input.root, host);
    const backupPath = path.join(input.backupDir, `${host}-mcp.json`);
    try { await readFile(backupPath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const original = await readOptional(target);
      await atomicWrite(backupPath, JSON.stringify({ ...original, target } satisfies HostFileBackup));
    }
    const current = await readOptional(target);
    const merged = host === 'codex'
      ? mergeCodexMcpConfig(current.content, endpoint.href)
      : mergeClaudeMcpConfig(current.content, endpoint.href);
    await atomicWrite(target, merged);
  }
}

export async function restoreHostMcpFiles(backupDir: string, hosts: SupportedHost[]): Promise<void> {
  for (const host of hosts) {
    const backupPath = path.join(backupDir, `${host}-mcp.json`);
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
