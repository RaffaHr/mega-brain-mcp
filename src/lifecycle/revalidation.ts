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
