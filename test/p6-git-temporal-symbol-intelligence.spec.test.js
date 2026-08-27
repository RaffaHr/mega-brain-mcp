import { describe, expect, it } from 'vitest';
import { gitSymbolHistory } from '../src/adapters/git/history.js';
import { createApplicationHandlers } from '../src/server/application.js';
import { openProvenanceDatabase } from '../src/provenance/database.js';
import { ProvenanceRepository } from '../src/provenance/repository.js';

describe('P6 Git temporal symbol intelligence (@spec:p6-git-temporal-symbol-intelligence)', () => {
  it('AC-092: Mineração de histórico de símbolos via Git Pickaxe @spec:AC-092', async () => {
    const mockGit = {
      run: async (args) => {
        const joined = args.join(' ');
        if (joined.includes('-ScalculateCoChangeCoupling')) {
          return ['c101', 'p1', '2026-08-10T10:00:00Z', 'feat: add calculateCoChangeCoupling'].join('\0') + '\n' +
                 ['c102', 'p2', '2026-08-15T12:00:00Z', 'refactor: update calculateCoChangeCoupling signature'].join('\0') + '\n';
        }
        return '';
      },
    };

    const commits = await gitSymbolHistory(mockGit, 'calculateCoChangeCoupling', 10);
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe('c101');
    expect(commits[0].subject).toContain('feat: add calculateCoChangeCoupling');
    expect(commits[1].hash).toBe('c102');
  });

  it('AC-093: Linha do tempo de episódios ancorada no brain_history @spec:AC-093', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);

    let timelineAnchorCalledWith = null;
    const mockAgentMemory = {
      timeline: async (params) => {
        timelineAnchorCalledWith = params.anchor;
        return {
          episodes: [
            { id: 'ep-1', createdAt: '2026-08-20T10:00:00Z', content: 'Observed bug in token validation' },
            { id: 'ep-2', createdAt: '2026-08-20T11:00:00Z', content: 'Fixed token validator in auth middleware' },
          ],
        };
      },
      memories: async () => ({ memories: [] }),
      sessions: async () => ({ sessions: [] }),
      health: async () => ({ status: 'healthy' }),
    };

    const mockCRG = {
      call: async () => ({ structuredContent: {} }),
      start: async () => {},
      serverVersion: () => '2.3.7',
    };

    const handlers = createApplicationHandlers({
      config: { dataDir: '.test-data' },
      identity: { root: '/repo', checkoutId: 'chk-6', worktreeId: 'proj-6', repositoryId: 'repo-6' },
      git: null,
      agentMemory: mockAgentMemory,
      codeReviewGraph: mockCRG,
      provenance: repo,
    });

    const historyResult = await handlers.brain_history({
      anchor: 'ep-1',
      limit: 10,
    });

    expect(timelineAnchorCalledWith).toBe('ep-1');
    expect(historyResult.result.timeline.length).toBe(2);
    expect(historyResult.result.timeline[0].summary).toContain('Observed bug');
    expect(historyResult.result.timeline[1].summary).toContain('Fixed token validator');
  });

  it('AC-094: Alerta de risco por símbolo com alto churn histórico @spec:AC-094', async () => {
    const db = openProvenanceDatabase(':memory:');
    const repo = new ProvenanceRepository(db);

    const mockGit = {
      head: async () => 'head-sha',
      status: async () => [],
      run: async (args) => {
        const joined = args.join(' ');
        if (joined.includes('-SauthHandler')) {
          // 6 commits to trigger high symbol churn (> 5)
          return Array.from({ length: 6 }, (_, i) => ['c' + i, 'p', '2026-08-2' + i + 'T10:00:00Z', 'fix: authHandler patch ' + i].join('\0') + '\n').join('');
        }
        return '';
      },
    };

    const mockCRG = {
      call: async (tool) => {
        if (tool === 'get_impact_radius_tool') return { structuredContent: ['src/server.ts'] };
        if (tool === 'get_affected_flows_tool') return { structuredContent: ['loginFlow'] };
        if (tool === 'query_graph_tool') return { structuredContent: ['testAuth'] };
        return { content: [] };
      },
      start: async () => {},
      serverVersion: () => '2.3.7',
    };

    const mockAgentMemory = {
      smartSearch: async () => ({ results: [] }),
      health: async () => ({ status: 'healthy' }),
    };

    const handlers = createApplicationHandlers({
      config: { dataDir: '.test-data' },
      identity: { root: '/repo', checkoutId: 'chk-6', worktreeId: 'proj-6', repositoryId: 'repo-6' },
      git: mockGit,
      agentMemory: mockAgentMemory,
      codeReviewGraph: mockCRG,
      provenance: repo,
    });

    const changeContext = await handlers.brain_change_context({
      target: 'authHandler',
    });

    expect(changeContext.result.symbolChurnCount).toBe(6);
    expect(changeContext.result.riskWarning).toContain('High symbol risk: authHandler modified in 6 commits');
    expect(changeContext.warnings).toContain('High symbol risk: authHandler modified in 6 commits (high churn hotspot)');
  });
});
