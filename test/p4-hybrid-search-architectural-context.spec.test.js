import { describe, expect, it } from 'vitest';
import { openProvenanceDatabase } from '../src/provenance/database.js';
import { ProvenanceRepository } from '../src/provenance/repository.js';
import { createApplicationHandlers } from '../src/server/application.js';

describe('P4 Hybrid search & architectural context (@spec:p4-hybrid-search-architectural-context)', () => {
  it('AC-086: Indexa memórias em FTS5 e executa busca lexical BM25 @spec:AC-086', () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);

    repo.registerProject({
      id: 'proj-1',
      checkoutId: 'chk-1',
      worktreeId: 'proj-1',
      root: '/repo',
    });

    repo.saveMemoryReference({
      memoryId: 'mem-101',
      projectId: 'proj-1',
      state: 'FRESH',
      confidence: 0.95,
      statement: 'Function calculateCoChangeCoupling computes temporal churn',
      type: 'rule',
      evidence: [
        { path: 'src/history.ts', symbol: 'calculateCoChangeCoupling', blobHash: 'b1', commitHash: 'c1' },
      ],
    });

    repo.saveMemoryReference({
      memoryId: 'mem-102',
      projectId: 'proj-1',
      state: 'FRESH',
      confidence: 0.8,
      statement: 'Tree-sitter parser extracts abstract syntax tree symbols',
      type: 'fact',
      evidence: [
        { path: 'src/parser.ts', symbol: 'parseAst', blobHash: 'b2', commitHash: 'c2' },
      ],
    });

    const results = repo.searchLexical('calculateCoChangeCoupling', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memoryId).toBe('mem-101');
    expect(results[0].statement).toContain('calculateCoChangeCoupling');
    expect(results[0].score).toBeGreaterThan(0);

    const empty = repo.searchLexical('nonExistentTerm12345', 5);
    expect(empty).toEqual([]);
  });

  it('AC-087: brain_recall funde fontes via RRF incluindo provenance_lexical @spec:AC-087', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);
    repo.registerProject({
      id: 'worktree-1',
      checkoutId: 'chk-1',
      worktreeId: 'worktree-1',
      root: '/repo',
    });

    repo.saveMemoryReference({
      memoryId: 'mem-201',
      projectId: 'worktree-1',
      state: 'FRESH',
      confidence: 1.0,
      statement: 'Tokenization logic uses unicode61 porter tokenizer',
      type: 'fact',
      evidence: [{ path: 'src/tokenizer.ts', blobHash: 'b1', commitHash: 'c1' }],
    });

    const mockAgentMemory = {
      smartSearch: async () => ({ results: [{ id: 'mem-remote-1', content: 'General tokenization concept', score: 0.75 }] }),
      health: async () => ({ status: 'healthy', version: '0.9.29' }),
      remember: async () => ({ id: 'mem-1' }),
      memories: async () => ({ results: [] }),
      sessions: async () => ({ results: [] }),
    };

    const mockCRG = {
      call: async (tool) => {
        if (tool === 'get_minimal_context_tool') return { content: [{ text: 'tokenizer module dependency' }] };
        return { content: [] };
      },
      start: async () => {},
      serverVersion: () => '2.3.7',
    };

    const mockGit = {
      head: async () => 'head-sha-123',
      status: async () => [],
      log: async () => [{ hash: 'commit-1', subject: 'refactor tokenizer', authoredAt: '2026-08-20' }],
    };

    const handlers = createApplicationHandlers({
      config: { dataDir: '.test-data' },
      identity: { root: '/repo', checkoutId: 'chk-1', worktreeId: 'worktree-1', repositoryId: 'repo-1' },
      git: mockGit,
      agentMemory: mockAgentMemory,
      codeReviewGraph: mockCRG,
      provenance: repo,
    });

    const recall = await handlers.brain_recall({
      query: 'tokenizer',
      intent: 'implementation',
    });

    expect(recall.sources.length).toBeGreaterThan(0);
    const sourceKinds = recall.sources.map((s) => s.kind);
    expect(sourceKinds).toContain('provenance_lexical');
    expect(sourceKinds).toContain('agentmemory');
    expect(typeof recall.result.context).toBe('string');
    expect(recall.result.context).toContain('Tokenization logic');
  });

  it('AC-088: brain_recall injeta overview arquitetural do CRG quando intent é architecture @spec:AC-088', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);

    const mockAgentMemory = {
      smartSearch: async () => ({ results: [] }),
      health: async () => ({ status: 'healthy' }),
    };

    const mockCRG = {
      call: async (tool) => {
        if (tool === 'get_architecture_overview_tool') {
          return { structuredContent: { modules: ['server', 'provenance', 'orchestration'], boundaries: 'strict' } };
        }
        if (tool === 'get_minimal_context_tool') {
          return { content: [{ text: 'minimal context' }] };
        }
        return { content: [] };
      },
      start: async () => {},
      serverVersion: () => '2.3.7',
    };

    const handlers = createApplicationHandlers({
      config: { dataDir: '.test-data' },
      identity: { root: '/repo', checkoutId: 'chk-1', worktreeId: 'worktree-1', repositoryId: 'repo-1' },
      git: null,
      agentMemory: mockAgentMemory,
      codeReviewGraph: mockCRG,
      provenance: repo,
    });

    const recall = await handlers.brain_recall({
      query: 'how modules interact',
      intent: 'architecture',
    });

    expect(typeof recall.result.context).toBe('string');
    expect(recall.result.context).toContain('boundaries');
    expect(recall.result.context).toContain('strict');
  });
});
