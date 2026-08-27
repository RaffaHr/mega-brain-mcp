import type { ProvenanceRepository } from '../provenance/repository.js';
import type { LearningStore } from '../tools/brain-learn.js';

export interface ConsolidateOptions {
  projectId: string;
  minGroupSize?: number;
}

export interface ConsolidatedResult {
  consolidatedCount: number;
  groups: Array<{
    path: string;
    type: string;
    originalMemoryIds: string[];
    newMemoryId: string;
    statement: string;
  }>;
}

export async function consolidateMemories(
  provenance: ProvenanceRepository,
  learning: LearningStore,
  options: ConsolidateOptions,
): Promise<ConsolidatedResult> {
  const minGroupSize = options.minGroupSize ?? 2;
  const groups = provenance.findConsolidationCandidates(options.projectId, minGroupSize);
  const result: ConsolidatedResult = {
    consolidatedCount: 0,
    groups: [],
  };

  for (const group of groups) {
    if (group.memoryIds.length < minGroupSize) continue;

    const statements = group.statements.filter(Boolean);
    const combinedStatement = `[Consolidated ${group.type}] Module ${group.path}: ${statements.join(' | ')}`;

    const saved = await learning.save({
      statement: combinedStatement,
      type: group.type as never,
      evidence: [
        {
          path: group.path,
          blobHash: group.blobHash ?? 'consolidated',
          commitHash: group.commitHash ?? 'consolidated',
        },
      ],
    });

    if (saved.id) {
      provenance.saveMemoryReference({
        memoryId: saved.id,
        projectId: options.projectId,
        state: 'FRESH',
        confidence: 0.95,
        statement: combinedStatement,
        type: group.type,
        evidence: [
          {
            path: group.path,
            blobHash: group.blobHash ?? 'consolidated',
            commitHash: group.commitHash ?? 'consolidated',
          },
        ],
      });

      for (const oldId of group.memoryIds) {
        provenance.supersede(oldId, saved.id);
      }

      result.consolidatedCount++;
      result.groups.push({
        path: group.path,
        type: group.type,
        originalMemoryIds: group.memoryIds,
        newMemoryId: saved.id,
        statement: combinedStatement,
      });
    }
  }

  return result;
}
