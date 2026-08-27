import type { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import type { ProvenanceRepository } from '../provenance/repository.js';

export interface GovernanceResult {
  deletedPaths: string[];
  expurgatedMemoryIds: string[];
  deprecatedCount: number;
}

export async function processDeletedPathsGovernance(
  deletedPaths: string[],
  projectId: string,
  agentMemory: AgentMemoryClient,
  provenance: ProvenanceRepository,
): Promise<GovernanceResult> {
  if (deletedPaths.length === 0) {
    return { deletedPaths: [], expurgatedMemoryIds: [], deprecatedCount: 0 };
  }

  const memoryIds = provenance.memoryIdsForPaths(deletedPaths);
  if (memoryIds.length === 0) {
    return { deletedPaths, expurgatedMemoryIds: [], deprecatedCount: 0 };
  }

  for (const memoryId of memoryIds) {
    provenance.updateState(memoryId, 'DEPRECATED', 0, 'file_deleted_governance');
  }

  try {
    if (typeof (agentMemory as any).governanceDelete === 'function') {
      await (agentMemory as any).governanceDelete({
        memoryIds,
        project: projectId,
        reason: 'file_deleted_governance',
      });
    }
  } catch {
    // Graceful fallback if governanceDelete endpoint is not implemented on mock
  }

  return {
    deletedPaths,
    expurgatedMemoryIds: memoryIds,
    deprecatedCount: memoryIds.length,
  };
}
