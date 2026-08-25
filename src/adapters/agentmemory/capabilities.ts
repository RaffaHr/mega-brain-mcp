import type { AgentMemoryClient } from './client.js';

export interface AgentMemoryCapabilities {
  healthy: boolean;
  version: string | null;
  endpoints: readonly string[];
}

export const REQUIRED_AGENTMEMORY_ENDPOINTS = [
  'GET /agentmemory/livez',
  'GET /agentmemory/health',
  'POST /agentmemory/smart-search',
  'POST /agentmemory/remember',
  'POST /agentmemory/verify',
  'POST /agentmemory/timeline',
  'GET /agentmemory/memories',
  'GET /agentmemory/sessions',
  'DELETE /agentmemory/governance/memories',
] as const;

export async function probeAgentMemory(client: AgentMemoryClient): Promise<AgentMemoryCapabilities> {
  await client.livez();
  const health = await client.health();
  return {
    healthy: health.healthy ?? (health.status === 'ok' || health.status === 'healthy'),
    version: health.version ?? null,
    endpoints: REQUIRED_AGENTMEMORY_ENDPOINTS,
  };
}

export interface RemoteIsolationProbeResult {
  isolated: true;
  cleanupConfirmed: true;
  memoryId: string;
}

export async function probeRemoteAgentMemoryIsolation(
  client: AgentMemoryClient,
  input: { projectA: string; projectB: string; sentinel: string },
): Promise<RemoteIsolationProbeResult> {
  if (input.projectA === input.projectB) throw new Error('Remote isolation probe requires two distinct namespaces');
  const remembered = await client.remember({
    content: input.sentinel,
    concepts: ['mega-brain-isolation-probe'],
    metadata: { temporary: true, purpose: 'isolation-probe' },
    project: input.projectA,
  });
  if (!remembered.id) throw new Error('Remote AgentMemory probe did not return a memory id');

  let isolationError: Error | undefined;
  try {
    const [inA, inB] = await Promise.all([
      client.smartSearch({ query: input.sentinel, limit: 10, project: input.projectA }),
      client.smartSearch({ query: input.sentinel, limit: 10, project: input.projectB }),
    ]);
    const visibleInA = inA.results.some(({ id, content }) => id === remembered.id || content === input.sentinel);
    const visibleInB = inB.results.some(({ id, content }) => id === remembered.id || content === input.sentinel);
    if (!visibleInA || visibleInB) isolationError = new Error('Remote AgentMemory does not prove strict namespace isolation');
  } finally {
    await client.governanceDelete({
      memoryIds: [remembered.id],
      project: input.projectA,
      reason: 'mega-brain reversible isolation probe cleanup',
    });
  }

  const afterCleanup = await client.smartSearch({ query: input.sentinel, limit: 10, project: input.projectA });
  if (afterCleanup.results.some(({ id, content }) => id === remembered.id || content === input.sentinel)) {
    throw new Error('Remote AgentMemory isolation probe cleanup could not be confirmed');
  }
  if (isolationError) throw isolationError;
  return { isolated: true, cleanupConfirmed: true, memoryId: remembered.id };
}
