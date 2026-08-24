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
  'GET /agentmemory/sessions',
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
