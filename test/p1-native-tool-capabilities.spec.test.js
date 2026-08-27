// Testes de spec da feature p1-native-tool-capabilities
import { describe, expect, it } from 'vitest';
import { brainRecall } from '../src/tools/brain-recall.js';
import { brainChangeContext } from '../src/tools/brain-change-context.js';
import { rankEvidenceChunks, FRESHNESS_WEIGHTS } from '../src/orchestration/ranking.js';
import { AgentMemoryClient } from '../src/adapters/agentmemory/client.js';

describe('p1-native-tool-capabilities', () => {
  // US-028 — Busca semântica de nós no Code Review Graph
  it('AC-074: Utilização da tool semantic_search_nodes_tool em consultas de arquitetura @spec:AC-074', async () => {
    const calledTools = [];
    const mockCrgAdapter = {
      async recall(query, intent) {
        const isArchOrImpl = intent === 'architecture' || intent === 'implementation';
        calledTools.push('get_minimal_context_tool');
        if (isArchOrImpl) {
          calledTools.push('semantic_search_nodes_tool');
        }
        return [
          {
            id: 'crg-context',
            source: 'code_review_graph',
            text: 'minimal context text',
            retrieval: 0.9,
            intentFit: 1,
            freshness: 1,
            confidence: 0.9,
            provenance: 1,
            reinforcement: 0,
            reference: 'get_minimal_context_tool',
          },
          ...(isArchOrImpl
            ? [
                {
                  id: 'crg-semantic-nodes',
                  source: 'code_review_graph',
                  text: '{"nodes":["PaymentModule","OrderService"]}',
                  retrieval: 0.95,
                  intentFit: 1,
                  freshness: 1,
                  confidence: 0.95,
                  provenance: 1,
                  reinforcement: 0,
                  reference: 'semantic_search_nodes_tool',
                },
              ]
            : []),
        ];
      },
    };

    const emptyAdapter = {
      async recall() {
        return [];
      },
    };

    const res = await brainRecall(
      { query: 'como funciona a arquitetura do sistema', intent: 'architecture' },
      {
        project: 'proj-1',
        head: 'head-1',
        sources: {
          code_review_graph: mockCrgAdapter,
          agentmemory: emptyAdapter,
          git: emptyAdapter,
          provenance_lexical: emptyAdapter,
        },
      }
    );

    expect(res.status).toBe('ok');
    expect(calledTools).toContain('get_minimal_context_tool');
    expect(calledTools).toContain('semantic_search_nodes_tool');
    expect(res.result.context).toContain('semantic_search_nodes_tool');
    expect(res.result.context).toContain('PaymentModule');
  });

  // US-028 — Busca semântica de nós no Code Review Graph
  it('AC-075: Enriquecimento de contexto com busca de fluxos afetados em símbolos específicos @spec:AC-075', async () => {
    let getFlowCalled = false;
    const structureFn = async (target) => {
      getFlowCalled = true;
      return {
        dependencies: ['src/services/payment.ts'],
        flows: ['handlePayment -> processOrder -> sendEmail', 'caller: checkoutController'],
        tests: ['tests/payment.test.ts'],
      };
    };

    const experienceFn = async () => ({
      rules: ['Use TLS 1.3'],
      bugs: [],
      decisions: [],
      risks: [],
    });

    const res = await brainChangeContext(
      { target: 'processPayment' },
      {
        project: 'proj-1',
        head: 'head-1',
        structure: structureFn,
        experience: experienceFn,
      }
    );

    expect(res.status).toBe('ok');
    expect(getFlowCalled).toBe(true);
    expect(res.result.flows).toContain('handlePayment -> processOrder -> sendEmail');
    expect(res.result.context).toContain('handlePayment -> processOrder -> sendEmail');
  });

  // US-029 — Ranking via Reciprocal Rank Fusion (RRF) e busca híbrida
  it('AC-076: Ranqueamento híbrido RRF entre AgentMemory, CRG e Git @spec:AC-076', () => {
    const memoryChunk = {
      id: 'mem_1',
      source: 'agentmemory',
      text: 'JWT auth rules',
      retrieval: 0.9,
      intentFit: 0.9,
      freshness: 1.0,
      freshnessState: 'FRESH',
      confidence: 0.9,
      provenance: 1.0,
      reinforcement: 0,
      reference: 'memory:1',
    };

    const crgChunkStale = {
      id: 'crg_1',
      source: 'code_review_graph',
      text: 'Auth module graph nodes',
      retrieval: 0.99,
      intentFit: 1.0,
      freshness: 0.1,
      freshnessState: 'STALE',
      confidence: 0.95,
      provenance: 1.0,
      reinforcement: 0,
      reference: 'crg:1',
    };

    const gitChunk = {
      id: 'git_1',
      source: 'git',
      text: 'fix: auth token expiry commit',
      retrieval: 0.8,
      intentFit: 0.8,
      freshness: 0.6,
      freshnessState: 'POSSIBLY_STALE',
      confidence: 0.9,
      provenance: 1.0,
      reinforcement: 0,
      reference: 'git:1',
    };

    expect(FRESHNESS_WEIGHTS.FRESH).toBe(1.0);
    expect(FRESHNESS_WEIGHTS.POSSIBLY_STALE).toBe(0.6);
    expect(FRESHNESS_WEIGHTS.STALE).toBe(0.1);

    const ranked = rankEvidenceChunks([crgChunkStale, memoryChunk, gitChunk], 60);

    // crgChunkStale had highest retrieval, but STALE freshness (0.1 factor) pushes it down
    // memoryChunk has FRESH (1.0 factor) and rank 1 in its source, so it tops RRF
    expect(ranked[0].id).toBe('mem_1');
    expect(ranked[ranked.length - 1].id).toBe('crg_1');
  });

  // US-029 — Ranking via Reciprocal Rank Fusion (RRF) e busca híbrida
  it('AC-077: Inclusão de lições consolidadas no smartSearch do AgentMemory @spec:AC-077', async () => {
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      if (url.toString().includes('/agentmemory/smart-search')) {
        capturedBody = JSON.parse(options.body);
        return new Response(JSON.stringify({ results: [{ id: 'm1', content: 'lesson 1', score: 0.9 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new AgentMemoryClient({
      baseUrl: 'http://127.0.0.1:8765',
      fetch: mockFetch,
    });

    const res = await client.smartSearch({
      query: 'error handling patterns',
      project: 'proj-1',
      includeLessons: true,
    });

    expect(res.results.length).toBe(1);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.includeLessons).toBe(true);
    expect(capturedBody.query).toBe('error handling patterns');
  });
});
