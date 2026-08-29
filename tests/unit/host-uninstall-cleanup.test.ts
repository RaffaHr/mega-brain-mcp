import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { restoreHostHookFiles } from '../../src/cli/host-hooks.js';
import { restoreHostMcpFiles } from '../../src/cli/host-integration.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

test('uninstall cleanup removes only Mega Brain MCP entries without backup files', async () => {
  const root = await tempRoot('mega-brain-mcp-cleanup-');
  await mkdir(path.join(root, '.codex'), { recursive: true });
  await writeFile(path.join(root, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      external: { type: 'stdio', command: 'external-tool', args: ['serve'] },
      'mega-brain': { type: 'stdio', command: 'node', args: ['mega-brain', 'mcp'] },
    },
    otherSetting: true,
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, '.codex', 'config.toml'), [
    '[project]',
    'name = "shop"',
    '',
    '# >>> mega-brain mcp >>>',
    '[mcp_servers.mega-brain]',
    'command = "node"',
    'args = ["mega-brain", "mcp"]',
    '# <<< mega-brain mcp <<<',
    '',
    '[mcp_servers.external]',
    'command = "external-tool"',
    '',
  ].join('\n'), 'utf8');

  await restoreHostMcpFiles({ root, backupDir: path.join(root, 'missing-backups'), hosts: ['claude', 'codex'] });

  expect(JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'))).toEqual({
    mcpServers: { external: { type: 'stdio', command: 'external-tool', args: ['serve'] } },
    otherSetting: true,
  });
  const codexConfig = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  expect(codexConfig).toContain('[project]');
  expect(codexConfig).toContain('[mcp_servers.external]');
  expect(codexConfig).not.toContain('mega-brain');
});

test('uninstall cleanup preserves external host hooks added after install backup', async () => {
  const root = await tempRoot('mega-brain-hook-cleanup-');
  const backupDir = path.join(root, 'integration-backups');
  const hooksPath = path.join(root, '.codex', 'hooks.json');
  await mkdir(path.dirname(hooksPath), { recursive: true });
  await mkdir(backupDir, { recursive: true });
  await writeFile(path.join(backupDir, 'codex.json'), JSON.stringify({ existed: true, content: '{}', target: hooksPath }), 'utf8');
  await writeFile(hooksPath, `${JSON.stringify({
    permissions: { allow: ['Bash(git status)'] },
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'external capture' }] },
        { _megaBrain: true, hooks: [{ type: 'command', command: 'mega-brain hook host codex' }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: 'node ./dist/cli/index.js mega-brain hook host codex' }] },
      ],
    },
  }, null, 2)}\n`, 'utf8');

  await restoreHostHookFiles({ root, backupDir, hosts: ['codex'] });

  const cleaned = JSON.parse(await readFile(hooksPath, 'utf8'));
  expect(cleaned.permissions).toEqual({ allow: ['Bash(git status)'] });
  expect(cleaned.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: 'external capture' }] }]);
  expect(cleaned.hooks.Stop).toBeUndefined();
});

test('uninstall cleanup restores MCP backups byte-for-byte', async () => {
  const root = await tempRoot('mega-brain-mcp-backup-');
  const backupDir = path.join(root, 'integration-backups');
  const target = path.join(root, '.codex', 'config.toml');
  const original = '[mcp_servers.existing]\r\nurl = "http://localhost:9999/mcp"\r\n';

  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(backupDir, { recursive: true });
  await writeFile(path.join(backupDir, 'codex-mcp.json'), JSON.stringify({ existed: true, content: original, target }), 'utf8');
  await writeFile(target, '# managed content\n', 'utf8');

  await restoreHostMcpFiles({ root, backupDir, hosts: ['codex'] });

  expect(await readFile(target, 'utf8')).toBe(original);
});
