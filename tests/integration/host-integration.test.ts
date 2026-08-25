import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { installHostMcpFiles, restoreHostMcpFiles } from '../../src/cli/host-integration.js';
import { installHostHookFiles, restoreHostHookFiles } from '../../src/cli/host-hooks.js';

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

test('AC-032: install merges one public MCP in Codex and Claude without exposing private backends @spec:AC-032', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-host-mcp-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, '.codex'), { recursive: true });
  const codexOriginal = '[mcp_servers.existing]\nurl = "http://127.0.0.1:9000/mcp"\n';
  const claudeOriginal = '{\n  "custom": true,\n  "mcpServers": { "existing": { "type": "http", "url": "http://127.0.0.1:9000/mcp" } }\n}\n';
  await writeFile(path.join(root, '.codex', 'config.toml'), codexOriginal, 'utf8');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"custom":true,"hooks":{}}\n', 'utf8');
  await writeFile(path.join(root, '.mcp.json'), claudeOriginal, 'utf8');
  const backupDir = path.join(root, '.state', 'backups');
  const input = {
    root,
    backupDir,
    hosts: ['codex', 'claude'] as const,
    connection: { transport: 'stdio' as const, command: 'mega-brain', args: ['mcp', '--repo', root] },
  };
  await installHostMcpFiles(input);
  await installHostHookFiles({ root, backupDir, hosts: ['codex', 'claude'] });
  await installHostMcpFiles(input);
  await installHostHookFiles({ root, backupDir, hosts: ['codex', 'claude'] });

  const codex = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  const claude = await readFile(path.join(root, '.mcp.json'), 'utf8');
  expect(codex.match(/\[mcp_servers\.mega-brain]/g)).toHaveLength(1);
  expect(codex).toContain('[mcp_servers.existing]');
  expect(claude).toContain('"existing"');
  expect(Object.keys((JSON.parse(claude) as { mcpServers: Record<string, unknown> }).mcpServers)
    .filter((name) => name === 'mega-brain')).toHaveLength(1);
  expect(codex).toContain('command = "mega-brain"');
  expect(codex).toContain('args = ["mcp"');
  expect(claude).toContain('"type": "stdio"');
  expect(claude).toContain('"command": "mega-brain"');
  expect(`${codex}\n${claude}`).not.toContain('127.0.0.1:3000');
  expect(`${codex}\n${claude}`).not.toContain('agentmemory');
  expect(`${codex}\n${claude}`).not.toContain('code-review-graph');
  expect(await readFile(path.join(root, '.codex', 'hooks.json'), 'utf8')).toContain('mega-brain hook host codex');
  expect(await readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8')).toContain('mega-brain hook host claude');
});

test('AC-033: repeated restore returns host MCP files byte for byte and removes created files @spec:AC-033', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-host-restore-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, '.codex'), { recursive: true });
  const original = '# keep spacing\r\n[mcp_servers.existing]\r\nurl="http://example.test/mcp"\r\n';
  await writeFile(path.join(root, '.codex', 'config.toml'), original, 'utf8');
  const hooksOriginal = '{\r\n  "custom": true,\r\n  "hooks": {}\r\n}\r\n';
  await writeFile(path.join(root, '.codex', 'hooks.json'), hooksOriginal, 'utf8');
  const backupDir = path.join(root, '.state', 'backups');
  await installHostMcpFiles({
    root,
    backupDir,
    hosts: ['codex', 'claude'],
    connection: { transport: 'stdio', command: 'mega-brain', args: ['mcp', '--repo', root] },
  });
  await installHostHookFiles({ root, backupDir, hosts: ['codex', 'claude'] });
  await restoreHostHookFiles(backupDir, ['codex', 'claude']);
  await restoreHostHookFiles(backupDir, ['codex', 'claude']);
  await restoreHostMcpFiles(backupDir, ['codex', 'claude']);
  await restoreHostMcpFiles(backupDir, ['codex', 'claude']);
  expect(await readFile(path.join(root, '.codex', 'config.toml'), 'utf8')).toBe(original);
  expect(await readFile(path.join(root, '.codex', 'hooks.json'), 'utf8')).toBe(hooksOriginal);
  await expect(readFile(path.join(root, '.mcp.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

test('AC-039: Streamable HTTP permanece disponível somente quando solicitado explicitamente @spec:AC-039', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-host-http-'));
  temporaryDirectories.push(root);
  const backupDir = path.join(root, '.state', 'backups');
  await installHostMcpFiles({
    root,
    backupDir,
    hosts: ['codex', 'claude'],
    connection: { transport: 'http', url: 'http://127.0.0.1:4321/mcp' },
  });

  expect(await readFile(path.join(root, '.codex', 'config.toml'), 'utf8')).toContain('url = "http://127.0.0.1:4321/mcp"');
  expect(await readFile(path.join(root, '.mcp.json'), 'utf8')).toContain('"type": "http"');
});
