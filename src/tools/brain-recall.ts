import { buildContextPack, type RecallBudget } from '../orchestration/context-builder.js';
import { classifyIntent, type RecallIntent } from '../orchestration/intent.js';
import type { EvidenceChunk } from '../orchestration/ranking.js';
import { routeRecall, type RecallSource } from '../orchestration/router.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface RecallSourceAdapter {
  recall(query: string, intent: RecallIntent): Promise<EvidenceChunk[]>;
}

export interface BrainRecallDependencies {
  sources: Partial<Record<RecallSource, RecallSourceAdapter>>;
  project: string;
  head: string;
  maxTokenBudget?: number;
}

export async function brainRecall(
  input: { query: string; intent?: RecallIntent; budget?: RecallBudget },
  dependencies: BrainRecallDependencies,
): Promise<MegaBrainEnvelope> {
  const intent = classifyIntent(input.query, input.intent);
  const route = routeRecall(intent);
  const warnings: string[] = [];
  const chunks: EvidenceChunk[] = [];
  const usedSources: RecallSource[] = [];
  for (const source of route) {
    const adapter = dependencies.sources[source];
    if (!adapter) {
      warnings.push(`${source} unavailable`);
      continue;
    }
    try {
      const recalled = await adapter.recall(input.query, intent);
      chunks.push(...recalled);
      usedSources.push(source);
    } catch {
      warnings.push(`${source} unavailable`);
    }
  }
  if (chunks.length === 0) throw new Error('No recall source could answer the query');
  const pack = buildContextPack(chunks, input.budget ?? 'NORMAL', dependencies.maxTokenBudget);
  const confidence = pack.chunks.length
    ? pack.chunks.reduce((sum, chunk) => sum + chunk.confidence, 0) / pack.chunks.length
    : 0;
  return createEnvelope(
    { intent, context: pack.text, estimatedTokens: pack.estimatedTokens, budget: pack.budget },
    {
      status: warnings.length ? 'degraded' : 'ok',
      project: dependencies.project,
      head: dependencies.head,
      confidence,
      freshness: pack.chunks.every((chunk) => chunk.freshness === 1) ? 'FRESH' : 'POSSIBLY_STALE',
      sources: usedSources.map((source) => ({ kind: source, reference: source, authority: 1 })),
      warnings,
    },
  );
}
