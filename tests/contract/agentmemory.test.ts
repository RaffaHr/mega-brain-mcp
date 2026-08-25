import { describe, expect, test, vi } from 'vitest';

import { AgentMemoryClient, AgentMemoryError } from '../../src/adapters/agentmemory/client.js';
import { probeAgentMemory, probeRemoteAgentMemoryIsolation } from '../../src/adapters/agentmemory/capabilities.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AgentMemory REST adapter', () => {
  test('uses documented endpoints, bearer auth and validated responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const url = String(request);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-value');
      if (url.endsWith('/livez')) return jsonResponse({ status: 'ok' });
      if (url.endsWith('/health')) return jsonResponse({ status: 'healthy', version: '0.9.29' });
      if (url.endsWith('/smart-search')) return jsonResponse({ results: [{ id: 7, content: 'JWT decision', score: 0.9 }] });
      return jsonResponse({ id: 'memory-1' }, 201);
    });
    const client = new AgentMemoryClient({ baseUrl: 'http://127.0.0.1:3111', authToken: 'secret-value', fetch });

    expect(await probeAgentMemory(client)).toMatchObject({ healthy: true, version: '0.9.29' });
    expect((await client.smartSearch({ query: 'jwt', limit: 5 })).results[0]?.id).toBe('7');
    expect(await client.remember({ content: 'lesson', concepts: ['auth'] })).toMatchObject({ id: 'memory-1' });
  });

  test('classifies backend and schema failures without exposing response bodies', async () => {
    const unavailable = new AgentMemoryClient({
      baseUrl: 'http://127.0.0.1:3111',
      fetch: async () => jsonResponse({ secret: 'must-not-leak' }, 503),
    });
    await expect(unavailable.health()).rejects.toMatchObject({ status: 503, retryable: true });
    await expect(unavailable.health()).rejects.not.toThrow(/must-not-leak/);

    const incompatible = new AgentMemoryClient({
      baseUrl: 'http://127.0.0.1:3111',
      fetch: async () => jsonResponse(['unexpected']),
    });
    await expect(incompatible.health()).rejects.toBeInstanceOf(AgentMemoryError);
  });

  test('AC-049: probe remoto prova A, ausência em B e cleanup confirmado @spec:AC-049', async () => {
    const records = new Map<string, Array<{ id: string; content: string }>>();
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const url = new URL(String(request));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      bodies.push(body);
      if (url.pathname.endsWith('/remember')) {
        const project = String(body.project);
        const record = { id: 'probe-memory', content: String(body.content) };
        records.set(project, [...(records.get(project) ?? []), record]);
        return jsonResponse({ id: record.id }, 201);
      }
      if (url.pathname.endsWith('/smart-search')) {
        const project = String(body.project);
        const query = String(body.query);
        return jsonResponse({ results: (records.get(project) ?? []).filter(({ content }) => content.includes(query)) });
      }
      if (url.pathname.endsWith('/governance/memories')) {
        const ids = new Set((body.memoryIds ?? []) as string[]);
        const project = String(body.project);
        records.set(project, (records.get(project) ?? []).filter(({ id }) => !ids.has(id)));
        return jsonResponse({ deleted: ids.size });
      }
      return jsonResponse({ status: 'ok' });
    });
    const client = new AgentMemoryClient({ baseUrl: 'https://memory.example.test', authToken: 'secret', fetch });

    await expect(probeRemoteAgentMemoryIsolation(client, {
      projectA: 'worktree-a',
      projectB: 'worktree-b',
      sentinel: 'mega-brain-isolation-sentinel',
    })).resolves.toMatchObject({ isolated: true, cleanupConfirmed: true });

    expect(records.get('worktree-a')).toEqual([]);
    expect(records.get('worktree-b') ?? []).toEqual([]);
    expect(bodies.filter((body) => body.project).every((body) => typeof body.project === 'string')).toBe(true);
  });
});
