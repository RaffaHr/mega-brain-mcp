import type { RecallSource } from './router.js';

export interface EvidenceChunk {
  id: string;
  source: RecallSource;
  text: string;
  retrieval: number;
  intentFit: number;
  freshness: number;
  confidence: number;
  provenance: number;
  reinforcement: number;
  reference: string;
  freshnessState?: 'FRESH' | 'POSSIBLY_STALE' | 'STALE' | string;
}

export const FRESHNESS_WEIGHTS: Record<string, number> = {
  FRESH: 1.0,
  POSSIBLY_STALE: 0.6,
  STALE: 0.1,
};

export function getFreshnessFactor(chunk: EvidenceChunk): number {
  if (chunk.freshnessState && FRESHNESS_WEIGHTS[chunk.freshnessState] !== undefined) {
    return FRESHNESS_WEIGHTS[chunk.freshnessState]!;
  }
  if (chunk.freshness >= 1.0) return FRESHNESS_WEIGHTS['FRESH'] ?? 1.0;
  if (chunk.freshness <= 0.2) return FRESHNESS_WEIGHTS['STALE'] ?? 0.1;
  return FRESHNESS_WEIGHTS['POSSIBLY_STALE'] ?? 0.6;
}

export function rankEvidence(chunk: EvidenceChunk): number {
  const baseScore =
    chunk.retrieval * 0.35 +
    chunk.intentFit * 0.25 +
    chunk.confidence * 0.2 +
    chunk.provenance * 0.15 +
    chunk.reinforcement * 0.05;
  return baseScore * getFreshnessFactor(chunk);
}

export function rankEvidenceChunks(chunks: EvidenceChunk[], k = 60): EvidenceChunk[] {
  if (chunks.length === 0) return [];

  // Group chunks by source list
  const bySource = new Map<RecallSource, EvidenceChunk[]>();
  for (const chunk of chunks) {
    const list = bySource.get(chunk.source) ?? [];
    list.push(chunk);
    bySource.set(chunk.source, list);
  }

  // Sort each source list by initial individual relevance/retrieval
  for (const [, list] of bySource) {
    list.sort((a, b) => rankEvidence(b) - rankEvidence(a) || a.id.localeCompare(b.id));
  }

  // Calculate RRF scores
  // RRF(d) = sum( 1 / (k + rank_m(d)) ) * FreshnessFactor * (confidence || 1)
  const rrfScores = new Map<string, number>();

  for (const [, list] of bySource) {
    list.forEach((chunk, index) => {
      const rank = index + 1; // 1-based rank
      const rrfContribution = 1 / (k + rank);
      const current = rrfScores.get(chunk.id) ?? 0;
      rrfScores.set(chunk.id, current + rrfContribution);
    });
  }

  return [...chunks].sort((left, right) => {
    const freshnessLeft = getFreshnessFactor(left);
    const freshnessRight = getFreshnessFactor(right);

    const scoreLeft = (rrfScores.get(left.id) ?? 0) * freshnessLeft;
    const scoreRight = (rrfScores.get(right.id) ?? 0) * freshnessRight;

    return scoreRight - scoreLeft || left.id.localeCompare(right.id);
  });
}
