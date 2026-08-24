import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface BackendHealth {
  name: 'agentmemory' | 'code_review_graph';
  healthy: boolean;
  version: string | null;
  detail?: string;
}

export function brainStatus(input: {
  project: string;
  head: string;
  graphHead?: string;
  backends: BackendHealth[];
  hooksHealthy: boolean;
  queueDepth: number;
}): MegaBrainEnvelope {
  const warnings = input.backends.filter(({ healthy }) => !healthy).map(({ name }) => `${name} unavailable`);
  if (input.graphHead && input.graphHead !== input.head) warnings.push('code_review_graph index is behind Git HEAD');
  return createEnvelope(
    {
      backends: input.backends.map(({ detail: _detail, ...health }) => health),
      hooksHealthy: input.hooksHealthy,
      queueDepth: input.queueDepth,
      graphHead: input.graphHead ?? null,
    },
    {
      status: warnings.length ? 'degraded' : 'ok',
      project: input.project,
      head: input.head,
      confidence: warnings.length ? 0.5 : 1,
      freshness: input.graphHead && input.graphHead !== input.head ? 'POSSIBLY_STALE' : 'FRESH',
      warnings,
      sources: [{ kind: 'mega_brain', reference: 'local-status', authority: 1 }],
    },
  );
}
