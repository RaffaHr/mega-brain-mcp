import { describe, expect, test, vi } from 'vitest';

import { AgentMemoryClient, AgentMemoryError } from '../../src/adapters/agentmemory/client.js';
import { probeAgentMemory } from '../../src/adapters/agentmemory/capabilities.js';

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
});
