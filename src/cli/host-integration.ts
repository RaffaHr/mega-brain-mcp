import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { snapshotFile, type RuntimeTransaction } from '../runtime/transaction.js';
import type { SupportedHost } from './host-hooks.js';

interface HostFileBackup {
  existed: boolean;
  content: string;
  target: string;
}

const CODEX_BLOCK_START = '# >>> mega-brain mcp >>>';
const CODEX_BLOCK_END = '# <<< mega-brain mcp <<<';

export type HostMcpConnection =
  | { transport: 'stdio'; command: string; args: string[] }
  | { transport: 'http'; url: string };

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

function validatedConnection(connection: HostMcpConnection): HostMcpConnection {
  if (connection.transport === 'stdio') {
    if (!connection.command.trim()) throw new Error('MCP stdio command is required');
    if (connection.args.some((argument) => argument.length === 0)) throw new Error('MCP stdio arguments cannot be empty');
    return connection;
  }
  const endpoint = new URL(connection.url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('MCP endpoint must use HTTP or HTTPS');
  return { transport: 'http', url: endpoint.href };
}

export function mergeCodexMcpConfig(existing: string, input: HostMcpConnection): string {
  const base = removeCodexMegaBrainSection(existing);
  const connection = validatedConnection(input);
  const fields = connection.transport === 'stdio'
    ? `command = ${JSON.stringify(connection.command)}\nargs = ${JSON.stringify(connection.args)}`
    : `url = ${JSON.stringify(connection.url)}`;
  const block = `${CODEX_BLOCK_START}\n[mcp_servers.mega-brain]\n${fields}\n${CODEX_BLOCK_END}`;
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

export function mergeClaudeMcpConfig(existing: string, input: HostMcpConnection): string {
  const config = existing.trim() ? JSON.parse(existing) as Record<string, unknown> : {};
  const current = config.mcpServers;
  if (current !== undefined && (current === null || Array.isArray(current) || typeof current !== 'object')) {
    throw new Error('Claude .mcp.json mcpServers must be an object');
  }
  const connection = validatedConnection(input);
  config.mcpServers = {
    ...((current ?? {}) as Record<string, unknown>),
    'mega-brain': connection.transport === 'stdio'
      ? { type: 'stdio', command: connection.command, args: connection.args }
      : { type: 'http', url: connection.url },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function installHostMcpFiles(input: {
  root: string;
  backupDir: string;
  hosts: SupportedHost[];
  connection: HostMcpConnection;
  transaction?: RuntimeTransaction;
}): Promise<void> {
  const connection = validatedConnection(input.connection);
  await mkdir(input.backupDir, { recursive: true });
  for (const host of input.hosts) {
    const target = targetFor(input.root, host);
    const backupPath = path.join(input.backupDir, `${host}-mcp.json`);
    if (input.transaction) {
      await snapshotFile(input.transaction, target);
      await snapshotFile(input.transaction, backupPath);
    }
    try { await readFile(backupPath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const original = await readOptional(target);
      await atomicWrite(backupPath, JSON.stringify({ ...original, target } satisfies HostFileBackup));
    }
    const current = await readOptional(target);
    const merged = host === 'codex'
      ? mergeCodexMcpConfig(current.content, connection)
      : mergeClaudeMcpConfig(current.content, connection);
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
