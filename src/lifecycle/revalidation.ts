export interface RevalidationDependencies {
  findAffectedMemoryIds(paths: string[]): Promise<string[]>;
  findBlastRadius(paths: string[]): Promise<string[]>;
  markPossiblyStale(memoryId: string, reason: string, commitHash: string): Promise<void>;
}

export interface RevalidationResult {
  changedPaths: string[];
  blastRadius: string[];
  invalidatedMemoryIds: string[];
}

export async function revalidateAfterChange(
  changedPaths: string[],
  commitHash: string,
  dependencies: RevalidationDependencies,
): Promise<RevalidationResult> {
  const directPaths = [...new Set(changedPaths)].sort();
  const blastRadius = [...new Set(await dependencies.findBlastRadius(directPaths))].sort();
  const [directMemories, relatedMemories] = await Promise.all([
    dependencies.findAffectedMemoryIds(directPaths),
    dependencies.findAffectedMemoryIds(blastRadius),
  ]);
  const direct = new Set(directMemories);
  const invalidatedMemoryIds = [...new Set([...directMemories, ...relatedMemories])].sort();
  for (const memoryId of invalidatedMemoryIds) {
    await dependencies.markPossiblyStale(memoryId, direct.has(memoryId) ? 'evidence_changed' : 'related_symbol_changed', commitHash);
  }
  return { changedPaths: directPaths, blastRadius, invalidatedMemoryIds };
}

export interface BatchReconciliationDependencies {
  findPossiblyStaleMemories(): Array<{ memoryId: string }>;
  checkAstFreshness(memoryId: string): Promise<{ isFresh: boolean; reason?: string }>;
  updateMemoryState(memoryId: string, state: 'FRESH' | 'STALE', confidence: number, reason: string): void;
}

export interface BatchReconciliationResult {
  totalEvaluated: number;
  restoredFresh: string[];
  confirmedStale: string[];
}

export async function reconcilePossiblyStaleMemories(
  dependencies: BatchReconciliationDependencies,
): Promise<BatchReconciliationResult> {
  const candidates = dependencies.findPossiblyStaleMemories();
  const result: BatchReconciliationResult = {
    totalEvaluated: candidates.length,
    restoredFresh: [],
    confirmedStale: [],
  };

  for (const { memoryId } of candidates) {
    const assessment = await dependencies.checkAstFreshness(memoryId);
    if (assessment.isFresh) {
      dependencies.updateMemoryState(memoryId, 'FRESH', 1.0, 'ast_hash_intact');
      result.restoredFresh.push(memoryId);
    } else {
      dependencies.updateMemoryState(memoryId, 'STALE', 0.1, assessment.reason ?? 'symbol_modified');
      result.confirmedStale.push(memoryId);
    }
  }

  return result;
}
