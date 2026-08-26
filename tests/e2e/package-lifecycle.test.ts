import { createServer } from 'node:net';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, expect, test, vi } from 'vitest';
import { stopManagedRuntime } from '../../src/cli/stop.js';
import { waitForService } from '../../src/cli/start.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { startRuntime, systemProcessController } from '../../src/runtime/supervisor.js';
import type { RuntimeLockManifest } from '../../src/runtime/lock-manifest.js';
import { createEnvelope } from '../../src/server/envelope.js';
import { createMegaBrainServer, listenMegaBrainServer, PUBLIC_TOOL_NAMES } from '../../src/server/index.js';

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test('AC-034: supervisor confirms spawn, enforces readiness and rolls back failures @spec:AC-034', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-ready-'));
  temporaryDirectories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(root, identity);
  const command = { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: root, lifecycle: 'daemon' as const };
  const manifest: RuntimeLockManifest = {
    schemaVersion: 1, installedAt: new Date().toISOString(), agentMemoryMode: 'managed',
    project: { repositoryId: identity.repositoryId, checkoutId: identity.checkoutId, worktreeId: identity.worktreeId },
    versions: { megaBrain: '0.1.3', agentMemory: '0.9.29', codeReviewGraph: '2.3.7' },
    backends: { agentMemory: command, codeReviewGraph: { ...command, lifecycle: 'on-demand' } },
  };
  await expect(startRuntime(layout, manifest, systemProcessController, { ready: async () => { throw new Error('not ready'); } })).rejects.toThrow('not ready');
  await expect(access(layout.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(systemProcessController.start({ ...command, command: path.join(root, 'missing-command') }, path.join(root, 'missing.log'))).rejects.toThrow('Failed to start');

  const check = vi.fn().mockRejectedValueOnce(new Error('booting')).mockResolvedValue({ status: 'ok' });
  await waitForService(check, { timeoutMs: 100, intervalMs: 1 });
  expect(check).toHaveBeenCalledTimes(2);
  await stopManagedRuntime(root, identity);
  await stopManagedRuntime(root, identity);
});

test('AC-034: Streamable HTTP handshake lists exactly six valid public tools and calls each @spec:AC-034', async () => {
  const handlers = Object.fromEntries(PUBLIC_TOOL_NAMES.map((name) => [name, async () => createEnvelope({ called: name })]));
  const server = createMegaBrainServer(handlers);
  const port = await freePort();
  await listenMegaBrainServer(server, port);
  const client = new Client({ name: 'mega-brain-e2e', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(PUBLIC_TOOL_NAMES);
    expect(listed.tools.every(({ inputSchema }) => inputSchema.type === 'object')).toBe(true);
    const inputs = {
      brain_recall: { query: 'architecture' },
      brain_learn: { statement: 'lesson' },
      brain_change_context: { target: 'src/example.ts' },
      brain_history: {},
      brain_validate: { memoryId: 'm1', outcome: 'confirmed', evidence: ['HEAD'] },
      brain_status: {},
    };
    for (const name of PUBLIC_TOOL_NAMES) {
      const result = await client.callTool({ name, arguments: inputs[name] });
      expect(result).toMatchObject({ structuredContent: { status: 'ok', result: { called: name } } });
      expect('isError' in result ? result.isError : false).not.toBe(true);
    }
  } finally {
    await client.close().catch(() => undefined);
    await server.forceClose().catch(() => undefined);
  }
});
