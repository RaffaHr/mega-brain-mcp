import { describe, expect, it } from 'vitest';
import { openProvenanceDatabase } from '../src/provenance/database.js';
import { ProvenanceRepository } from '../src/provenance/repository.js';
import { consolidateMemories } from '../src/learning/consolidation.js';
import { processDeletedPathsGovernance } from '../src/lifecycle/governance.js';
import { reconcilePossiblyStaleMemories } from '../src/lifecycle/revalidation.js';

describe('P5 Consolidation, governance & reconciliation (@spec:p5-consolidation-governance-reconciliation)', () => {
  it('AC-089: Agrupamento e síntese determinística de memórias do mesmo escopo @spec:AC-089', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);
    repo.registerProject({
      id: 'proj-5',
      checkoutId: 'chk-5',
      worktreeId: 'proj-5',
      root: '/repo',
    });

    repo.saveMemoryReference({
      memoryId: 'mem-rule-1',
      projectId: 'proj-5',
      state: 'FRESH',
      confidence: 1.0,
      statement: 'Check token validity before database query',
      type: 'rule',
      evidence: [{ path: 'src/auth.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    repo.saveMemoryReference({
      memoryId: 'mem-rule-2',
      projectId: 'proj-5',
      state: 'FRESH',
      confidence: 1.0,
      statement: 'Sanitize authorization header string',
      type: 'rule',
      evidence: [{ path: 'src/auth.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    const mockLearning = {
      saved: [],
      async save(input) {
        const id = 'mem-consolidated-1';
        this.saved.push({ id, ...input });
        return { id };
      },
    };

    const result = await consolidateMemories(repo, mockLearning, { projectId: 'proj-5', minGroupSize: 2 });
    expect(result.consolidatedCount).toBe(1);
    expect(result.groups[0].originalMemoryIds).toEqual(['mem-rule-1', 'mem-rule-2']);

    const oldState1 = repo.memoryState('mem-rule-1');
    const oldState2 = repo.memoryState('mem-rule-2');
    expect(oldState1.state).toBe('DEPRECATED');
    expect(oldState2.state).toBe('DEPRECATED');

    const newState = repo.memoryState('mem-consolidated-1');
    expect(newState.state).toBe('FRESH');
  });

  it('AC-090: Expurgo de memórias vinculadas a arquivos removidos no Git @spec:AC-090', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);
    repo.registerProject({
      id: 'proj-5',
      checkoutId: 'chk-5',
      worktreeId: 'proj-5',
      root: '/repo',
    });

    repo.saveMemoryReference({
      memoryId: 'mem-del-1',
      projectId: 'proj-5',
      state: 'FRESH',
      confidence: 1.0,
      statement: 'Legacy xml serializer handles xml export',
      type: 'fact',
      evidence: [{ path: 'src/legacy-xml.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    let governanceDeleteCalledWith = null;
    const mockAgentMemory = {
      governanceDelete: async (params) => {
        governanceDeleteCalledWith = params;
        return { success: true };
      },
    };

    const result = await processDeletedPathsGovernance(
      ['src/legacy-xml.ts'],
      'proj-5',
      mockAgentMemory,
      repo,
    );

    expect(result.deprecatedCount).toBe(1);
    expect(result.expurgatedMemoryIds).toContain('mem-del-1');
    expect(governanceDeleteCalledWith.memoryIds).toContain('mem-del-1');

    const state = repo.memoryState('mem-del-1');
    expect(state.state).toBe('DEPRECATED');
    expect(state.confidence).toBe(0);
  });

  it('AC-090: Expurgo local conclui mesmo com AgentMemory indisponível @spec:AC-090 @principle:P-006', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);
    repo.registerProject({ id: 'proj-5', checkoutId: 'chk-5', worktreeId: 'proj-5', root: '/repo' });
    repo.saveMemoryReference({
      memoryId: 'mem-del-1',
      projectId: 'proj-5',
      state: 'FRESH',
      confidence: 1.0,
      statement: 'Legacy xml serializer handles xml export',
      type: 'fact',
      evidence: [{ path: 'src/legacy-xml.ts', blobHash: 'b1', commitHash: 'c1' }],
    });
    const unavailableAgentMemory = {
      governanceDelete: async () => { throw new Error('backend down'); },
    };

    const result = await processDeletedPathsGovernance(
      ['src/legacy-xml.ts'],
      'proj-5',
      unavailableAgentMemory,
      repo,
    );

    expect(result.deprecatedCount).toBe(1);
    expect(result.expurgatedMemoryIds).toContain('mem-del-1');
    expect(repo.memoryState('mem-del-1').state).toBe('DEPRECATED');
  });

  it('AC-091: Reconciliação proativa de integridade de AST @spec:AC-091', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);
    repo.registerProject({
      id: 'proj-5',
      checkoutId: 'chk-5',
      worktreeId: 'proj-5',
      root: '/repo',
    });

    repo.saveMemoryReference({
      memoryId: 'mem-stale-1',
      projectId: 'proj-5',
      state: 'POSSIBLY_STALE',
      confidence: 0.5,
      statement: 'Auth handler token validator',
      type: 'rule',
      evidence: [{ path: 'src/auth.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    repo.saveMemoryReference({
      memoryId: 'mem-stale-2',
      projectId: 'proj-5',
      state: 'POSSIBLY_STALE',
      confidence: 0.5,
      statement: 'Database connector pool',
      type: 'fact',
      evidence: [{ path: 'src/db.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    const mockDependencies = {
      findPossiblyStaleMemories: () => repo.findMemoriesByState('POSSIBLY_STALE'),
      checkAstFreshness: async (memoryId) => {
        if (memoryId === 'mem-stale-1') {
          return { isFresh: true };
        }
        return { isFresh: false, reason: 'function_body_modified' };
      },
      updateMemoryState: (memoryId, state, confidence, reason) => {
        repo.updateState(memoryId, state, confidence, reason);
      },
    };

    const result = await reconcilePossiblyStaleMemories(mockDependencies);
    expect(result.totalEvaluated).toBe(2);
    expect(result.restoredFresh).toContain('mem-stale-1');
    expect(result.confirmedStale).toContain('mem-stale-2');

    expect(repo.memoryState('mem-stale-1').state).toBe('FRESH');
    expect(repo.memoryState('mem-stale-2').state).toBe('STALE');
  });
});
