import type { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { createLocalLogger } from '../observability/logger.js';
import type { ProvenanceRepository } from '../provenance/repository.js';

export interface GovernanceResult {
  deletedPaths: string[];
  expurgatedMemoryIds: string[];
  deprecatedCount: number;
}

/**
 * Deprecates the memories anchored to deleted paths and asks AgentMemory to
 * expunge them.
 *
 * The local provenance transition is the durable part, so an unavailable
 * AgentMemory is recorded and tolerated rather than raised: a Git hook must not
 * break because a backend is down.
 */
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
    await agentMemory.governanceDelete({ memoryIds, project: projectId, reason: 'file_deleted_governance' });
  } catch (error) {
    createLocalLogger().log('debug', 'governance: remote expurgation failed', {
      project: projectId,
      memories: memoryIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    deletedPaths,
    expurgatedMemoryIds: memoryIds,
    deprecatedCount: memoryIds.length,
  };
}
