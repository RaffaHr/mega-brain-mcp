import type { ProvenanceRepository } from '../provenance/repository.js';

export interface PromotionResult {
  promotedMemoryIds: string[];
}

export async function promoteCandidateMemories(
  provenance: ProvenanceRepository,
  filter?: { commitHash?: string; paths?: string[] },
): Promise<PromotionResult> {
  const candidates = provenance.findCandidateMemories(filter);
  const promoted: string[] = [];

  for (const candidate of candidates) {
    provenance.updateState(candidate.memoryId, 'ACTIVE', 1.0, 'test_suite_succeeded');
    promoted.push(candidate.memoryId);
  }

  return { promotedMemoryIds: promoted };
}
