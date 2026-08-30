import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface BackendHealth {
  name: 'agentmemory' | 'code_review_graph';
  healthy: boolean;
  version: string | null;
  detail?: string;
}

export interface MemoryStateMetrics {
  ACTIVE: number;
  POSSIBLY_STALE: number;
  STALE: number;
  SUPERSEDED: number;
  CANDIDATE?: number;
  CONFLICT?: number;
  DEPRECATED?: number;
  FRESH?: number;
  UNKNOWN?: number;
}

export interface DetailedStatusMetrics {
  graphNodeCount?: number;
  memoryCounts?: MemoryStateMetrics;
  retrievalLatencyMs?: number;
}

export function brainStatus(input: {
  project: string;
  head: string;
  graphHead?: string;
  backends: BackendHealth[];
  hooksHealthy: boolean;
  queueDepth: number;
  verbose?: boolean;
  metrics?: DetailedStatusMetrics;
}): MegaBrainEnvelope {
  const warnings = input.backends.filter(({ healthy }) => !healthy).map(({ name }) => `${name} unavailable`);
  if (input.graphHead && input.graphHead !== input.head) warnings.push('code_review_graph index is behind Git HEAD');
  if (!input.hooksHealthy) warnings.push('hook installation is unhealthy');
  if (input.queueDepth > 5) warnings.push(`hook queue depth is high (${input.queueDepth} pending events)`);

  const memoryCounts = input.metrics?.memoryCounts;
  if (memoryCounts) {
    const totalMemories = Object.values(memoryCounts).reduce((sum, count) => sum + count, 0);
    const staleMemories = (memoryCounts.STALE ?? 0) + (memoryCounts.DEPRECATED ?? 0);
    if (totalMemories > 0 && staleMemories / totalMemories > 0.2) {
      warnings.push(`high stale memory ratio: ${(staleMemories / totalMemories * 100).toFixed(1)}% of memories are stale`);
    }
  }

  const resultPayload: Record<string, unknown> = {
    backends: input.backends.map(({ detail: _detail, ...health }) => health),
    hooksHealthy: input.hooksHealthy,
    queueDepth: input.queueDepth,
    graphHead: input.graphHead ?? null,
  };

  if (input.verbose || input.metrics) {
    resultPayload.metrics = {
      graphNodeCount: input.metrics?.graphNodeCount ?? 0,
      memoryCounts: input.metrics?.memoryCounts ?? {
        ACTIVE: 0,
        POSSIBLY_STALE: 0,
        STALE: 0,
        SUPERSEDED: 0,
      },
      retrievalLatencyMs: input.metrics?.retrievalLatencyMs ?? 0,
    };
  }

  return createEnvelope(
    resultPayload,
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
