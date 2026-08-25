import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AgentMemoryClient } from '../../src/adapters/agentmemory/client.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { createRuntimeIsolation } from '../../src/runtime/lock-manifest.js';
import { ensureProjectSupervisor, startProjectSupervisor } from '../../src/runtime/project-supervisor.js';
import { runtimeLayout } from '../../src/runtime/layout.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('fixture did not bind'));
    resolve(`http://127.0.0.1:${address.port}`);
  }));
}

test('AC-047/048/056: projetos concorrentes mantêm namespaces, portas, IPC e leases separados @spec:AC-047 @spec:AC-048 @spec:AC-056', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-concurrent-projects-'));
  const firstIdentity = deriveProjectIdentity({ root: path.join(dataDir, 'first'), gitDir: '.git', commonGitDir: '.git' });
  const secondIdentity = deriveProjectIdentity({ root: path.join(dataDir, 'second'), gitDir: '.git', commonGitDir: '.git' });
  const firstLayout = runtimeLayout(dataDir, firstIdentity);
  const secondLayout = runtimeLayout(dataDir, secondIdentity);
  const firstIsolation = createRuntimeIsolation(firstLayout, firstIdentity.worktreeId);
  const secondIsolation = createRuntimeIsolation(secondLayout, secondIdentity.worktreeId);
  const memories = new Map<string, Array<Record<string, unknown>>>();
  const fixture = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
    const project = String(body.project);
    const records = memories.get(project) ?? [];
    if (request.url?.endsWith('/remember')) {
      const record = { id: `${project}-${records.length + 1}`, content: String(body.content), score: 1 };
      records.push(record);
      memories.set(project, records);
      response.end(JSON.stringify({ id: record.id }));
    } else response.end(JSON.stringify({ results: records }));
  });
  const baseUrl = await listen(fixture);
  let now = 0;
  const firstServer = await startProjectSupervisor({ layout: firstLayout, identity: firstIdentity, pid: process.pid, now: () => now });
  const secondServer = await startProjectSupervisor({ layout: secondLayout, identity: secondIdentity, pid: process.pid, now: () => now });
  try {
    expect(new Set([...Object.values(firstIsolation.ports), ...Object.values(secondIsolation.ports)]).size).toBe(8);
    expect(new Set([...Object.values(firstIsolation.paths), ...Object.values(secondIsolation.paths)]).size).toBe(8);
    expect(firstServer.manifest.ipcAddress).not.toBe(secondServer.manifest.ipcAddress);
    const first = await ensureProjectSupervisor({ layout: firstLayout, identity: firstIdentity, processExists: () => true });
    const second = await ensureProjectSupervisor({ layout: secondLayout, identity: secondIdentity, processExists: () => true });
    await Promise.all([
      first.client.acquire('first-codex'), first.client.acquire('first-claude'),
      second.client.acquire('second-codex'), second.client.acquire('second-claude'),
    ]);
    expect((await first.client.status()).leases.sort()).toEqual(['first-claude', 'first-codex']);
    expect((await second.client.status()).leases.sort()).toEqual(['second-claude', 'second-codex']);

    const memory = new AgentMemoryClient({ baseUrl });
    await Promise.all([
      memory.remember({ content: 'first-only-sentinel', project: firstIdentity.worktreeId }),
      memory.remember({ content: 'second-only-sentinel', project: secondIdentity.worktreeId }),
    ]);
    const [firstRecall, secondRecall] = await Promise.all([
      memory.smartSearch({ query: 'sentinel', project: firstIdentity.worktreeId }),
      memory.smartSearch({ query: 'sentinel', project: secondIdentity.worktreeId }),
    ]);
    expect(firstRecall.results.map(({ content }) => content)).toEqual(['first-only-sentinel']);
    expect(secondRecall.results.map(({ content }) => content)).toEqual(['second-only-sentinel']);

    await Promise.all([
      first.client.release('first-codex'), first.client.release('first-claude'),
      second.client.release('second-codex'), second.client.release('second-claude'),
    ]);
    now = 5_000;
    expect(await firstServer.checkIdle()).toBe(true);
    expect(await secondServer.checkIdle()).toBe(true);
  } finally {
    await firstServer.close().catch(() => undefined);
    await secondServer.close().catch(() => undefined);
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
}, 30_000);
