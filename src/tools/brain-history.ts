import { assembleHistory, type HistoryDependencies, type HistoryQuery } from '../orchestration/history.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface BrainHistoryDependencies<TStructure = unknown> extends HistoryDependencies<TStructure> {
  project: string;
  head: string;
}

export async function brainHistory<TStructure>(
  input: HistoryQuery,
  dependencies: BrainHistoryDependencies<TStructure>,
): Promise<MegaBrainEnvelope> {
  const result = await assembleHistory(input, dependencies);
  const sources = [...new Set(result.timeline.map((item) => item.source))].map((source) => ({
    kind: source === 'git' ? 'git' as const : 'agentmemory' as const,
    reference: source,
    authority: source === 'git' ? 1 : 0.8,
  }));
  return createEnvelope(result as unknown as Record<string, unknown>, {
    project: dependencies.project,
    head: dependencies.head,
    confidence: result.timeline.length ? 0.9 : 0.5,
    freshness: 'FRESH',
    sources,
    warnings: result.timeline.length ? [] : ['No historical events matched the query'],
    status: result.timeline.length ? 'ok' : 'degraded',
  });
}
