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
}

export function rankEvidence(chunk: EvidenceChunk): number {
  return (
    chunk.retrieval * 0.3 +
    chunk.intentFit * 0.2 +
    chunk.freshness * 0.2 +
    chunk.confidence * 0.15 +
    chunk.provenance * 0.1 +
    chunk.reinforcement * 0.05
  );
}

export function rankEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
  return [...chunks].sort((left, right) => rankEvidence(right) - rankEvidence(left) || left.id.localeCompare(right.id));
}
