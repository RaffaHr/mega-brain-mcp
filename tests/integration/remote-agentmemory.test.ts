import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { AgentMemoryClient } from '../../src/adapters/agentmemory/client.js';
import { probeRemoteAgentMemoryIsolation } from '../../src/adapters/agentmemory/capabilities.js';
import { installManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

test('AC-049: install remoto recusa isolamento inválido antes de arquivos ou downloads @spec:AC-049', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-remote-reject-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const runner: CommandRunner = { run: vi.fn(async () => undefined) };
  const runtimeRoot = runtimeLayout(dataDir, identity).runtimeRoot;

  await expect(installManagedRuntime({
    dataDir,
    identity,
    agentMemoryMode: 'remote',
    remoteAgentMemory: { baseUrl: 'https://memory.example.test' },
    remoteIsolationProbe: async () => { throw new Error('namespace B leaked the sentinel'); },
    runner,
    preflight: false,
  })).rejects.toThrow('namespace B leaked the sentinel');

  expect(runner.run).not.toHaveBeenCalled();
  expect(await access(runtimeRoot).then(() => true).catch(() => false)).toBe(false);
});

test('AC-049: probe remoto sempre remove sentinela, inclusive ao detectar vazamento @spec:AC-049', async () => {
  let deleted = false;
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith('/remember')) return Response.json({ id: 'sentinel-id' });
    if (request.url.endsWith('/governance/memories')) {
      deleted = true;
      return Response.json({ status: 'ok' });
    }
    if (request.url.endsWith('/smart-search')) {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (Array.isArray(body.expandIds)) {
        return Response.json({
          mode: 'expanded',
          results: [{ obsId: 'sentinel-id', observation: { id: 'sentinel-id', narrative: 'sentinel' } }],
        });
      }
      if (deleted) return Response.json({ results: [] });
      return Response.json({ results: [{ id: 'sentinel-id', content: 'sentinel' }] });
    }
    return Response.json({ status: 'ok' });
  }) as typeof globalThis.fetch;
  const client = new AgentMemoryClient({ baseUrl: 'https://memory.example.test', fetch });

  await expect(probeRemoteAgentMemoryIsolation(client, {
    projectA: 'project-a', projectB: 'project-b', sentinel: 'sentinel',
  })).rejects.toThrow(/strict namespace isolation/i);
  expect(deleted).toBe(true);
});

test('AC-049: probe remoto ignora candidato compacto que não hidrata no projeto consultado @spec:AC-049', async () => {
  let deleted = false;
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    bodies.push(body);
    if (request.url.endsWith('/remember')) return Response.json({ id: 'sentinel-id' });
    if (request.url.endsWith('/governance/memories')) {
      deleted = true;
      return Response.json({ status: 'ok' });
    }
    if (request.url.includes('/memories/sentinel-id')) {
      return Response.json({ memory: { id: 'sentinel-id', content: 'sentinel', project: 'project-a' } });
    }
    if (request.url.endsWith('/smart-search')) {
      if (Array.isArray(body.expandIds)) return Response.json({ mode: 'expanded', results: [] });
      if (deleted) return Response.json({ results: [] });
      return Response.json({ results: [{ obsId: 'sentinel-id', title: 'sentinel' }] });
    }
    return Response.json({ status: 'ok' });
  }) as typeof globalThis.fetch;
  const client = new AgentMemoryClient({ baseUrl: 'https://memory.example.test', fetch });

  await expect(probeRemoteAgentMemoryIsolation(client, {
    projectA: 'project-a', projectB: 'project-b', sentinel: 'sentinel',
  })).resolves.toMatchObject({ isolated: true, cleanupConfirmed: true });
  expect(deleted).toBe(true);
  expect(bodies).not.toContainEqual(expect.objectContaining({ requireHydratedResults: true }));
});
