import path from 'node:path';

import type { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import type { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { calculateCoChangeCoupling, gitHistory, gitSymbolHistory } from '../adapters/git/history.js';
import { NO_GIT_HEAD, type GitRepository } from '../adapters/git/repository.js';
import { committedBlobHash } from '../adapters/git/blobs.js';
import type { MegaBrainConfig } from '../config/schema.js';
import { DurableHookQueue } from '../hooks/queue.js';
import type { EvidenceInput, KnowledgeType } from '../learning/taxonomy.js';
import type { EvidenceChunk } from '../orchestration/ranking.js';
import type { RecallSource } from '../orchestration/router.js';
import type { ProjectIdentity } from '../projects/identity.js';
import type { ProvenanceRepository } from '../provenance/repository.js';
import { assessFreshness } from '../provenance/freshness.js';
import { brainChangeContext } from '../tools/brain-change-context.js';
import { brainHistory } from '../tools/brain-history.js';
import { brainLearn, type LearningStore } from '../tools/brain-learn.js';
import { brainRecall, type RecallSourceAdapter } from '../tools/brain-recall.js';
import { brainStatus } from '../tools/brain-status.js';
import { brainValidate, type ValidationStore } from '../tools/brain-validate.js';
import type { MegaBrainToolHandlers } from './index.js';

export interface ApplicationDependencies {
  config: MegaBrainConfig;
  identity: ProjectIdentity;
  git: GitRepository | null;
  agentMemory: AgentMemoryClient;
  codeReviewGraph: CodeReviewGraphClient;
  provenance: ProvenanceRepository;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join('\n');
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    return JSON.stringify(value);
  }
  return '';
}

function stringsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean);
  const text = textFromUnknown(value);
  return text ? [text] : [];
}

function assertProject(input: Record<string, unknown>, identity: ProjectIdentity): void {
  const requested = input.project;
  if (requested === undefined) return;
  if (requested !== identity.root && requested !== identity.worktreeId && requested !== identity.repositoryId) {
    throw new Error('Requested project does not match the configured checkout');
  }
}

async function currentHead(git: GitRepository | null): Promise<string> {
  if (!git) return NO_GIT_HEAD;
  return git.head();
}

function memoryRecall(client: AgentMemoryClient, project: string): RecallSourceAdapter {
  return {
    async recall(query) {
      const response = await client.smartSearch({ query, limit: 12, project, includeLessons: true });
      return response.results.flatMap((record, index): EvidenceChunk[] => record.content ? [{
        id: record.id ?? `memory-${index}`,
        source: 'agentmemory',
        text: record.content,
        retrieval: record.score ?? 0.7,
        intentFit: 0.9,
        freshness: record.metadata?.freshness === 'FRESH' ? 1 : 0.65,
        ...(typeof record.metadata?.freshness === 'string' ? { freshnessState: record.metadata.freshness } : {}),
        confidence: typeof record.metadata?.confidence === 'number' ? record.metadata.confidence : 0.7,
        provenance: 0.8,
        reinforcement: 0.5,
        reference: `memory:${record.id ?? index}`,
      }] : []);
    },
  };
}

function graphText(result: { content: Array<Record<string, unknown>>; structuredContent?: Record<string, unknown> | undefined }): string {
  return result.structuredContent ? JSON.stringify(result.structuredContent) : stringsFromUnknown(result.content).join('\n');
}

function graphRecall(client: CodeReviewGraphClient): RecallSourceAdapter {
  return {
    async recall(query, intent) {
      const isArchOrImpl = intent === 'architecture' || intent === 'implementation';
      const [contextResult, semanticResult, archOverview] = await Promise.all([
        client.call('get_minimal_context_tool', { task: query }),
        isArchOrImpl
          ? client.call('semantic_search_nodes_tool', { query }).catch(() => null)
          : Promise.resolve(null),
        intent === 'architecture'
          ? client.call('get_architecture_overview_tool', {}).catch(() => null)
          : Promise.resolve(null),
      ]);

      const chunks: EvidenceChunk[] = [];
      const text = graphText(contextResult);
      if (text) {
        chunks.push({
          id: 'crg-context',
          source: 'code_review_graph',
          text,
          retrieval: 0.9,
          intentFit: 1,
          freshness: 0.9,
          confidence: 0.9,
          provenance: 1,
          reinforcement: 0,
          reference: 'get_minimal_context_tool',
        });
      }

      if (semanticResult) {
        const nodesText = graphText(semanticResult);
        if (nodesText) {
          chunks.push({
            id: 'crg-semantic-nodes',
            source: 'code_review_graph',
            text: nodesText,
            retrieval: 0.95,
            intentFit: 1,
            freshness: 0.9,
            confidence: 0.95,
            provenance: 1,
            reinforcement: 0,
            reference: 'semantic_search_nodes_tool',
          });
        }
      }

      if (archOverview) {
        const archText = graphText(archOverview);
        if (archText) {
          chunks.push({
            id: 'crg-architecture-overview',
            source: 'code_review_graph',
            text: archText,
            retrieval: 0.92,
            intentFit: 1,
            freshness: 1.0,
            confidence: 0.95,
            provenance: 1,
            reinforcement: 0,
            reference: 'get_architecture_overview_tool',
          });
        }
      }

      return chunks;
    },
  };
}

function gitRecall(repository: GitRepository): RecallSourceAdapter {
  return {
    async recall(query) {
      const commits = await gitHistory(repository, 12);
      const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
      return commits.filter(({ subject }) => terms.some((term) => subject.toLowerCase().includes(term))).map((commit) => ({
        id: commit.hash, source: 'git' as const, text: `${commit.authoredAt} ${commit.subject}`,
        retrieval: 0.7, intentFit: 0.7, freshness: 1, confidence: 1, provenance: 1,
        reinforcement: 0, reference: commit.hash,
      }));
    },
  };
}

function lexicalRecall(provenance: ProvenanceRepository): RecallSourceAdapter {
  return {
    async recall(query) {
      const results = provenance.searchLexical(query, 8);
      return results.map((record) => ({
        id: `fts-${record.memoryId}`,
        source: 'provenance_lexical' as const,
        text: `[${record.type}] ${record.statement}`,
        retrieval: record.score,
        intentFit: 0.85,
        freshness: 1.0,
        confidence: 0.9,
        provenance: 1.0,
        reinforcement: 0,
        reference: `memory:${record.memoryId}`,
      }));
    },
  };
}

function learningStore(client: AgentMemoryClient, project: string): LearningStore {
  return {
    async findEquivalent(statement) {
      const found = (await client.smartSearch({ query: statement, limit: 3, project })).results.find(({ content }) => content?.trim().toLowerCase() === statement.trim().toLowerCase());
      return found?.id && found.content ? { id: found.id, statement: found.content } : undefined;
    },
    async save(input) {
      const response = await client.remember({
        content: String(input.statement),
        metadata: input,
        project,
      });
      if (!response.id) throw new Error('AgentMemory did not return a memory id');
      return { id: response.id };
    },
    async reinforce(_id, _evidence) {
      // Score and trust are tracked via provenance and ranking; avoid polluting AgentMemory with synthetic entries
    },
    async recordConflict(_existingId, _replacementId) {
      // Handled via provenance state transition without polluting AgentMemory
    },
    async supersede(_existingId, _replacementId) {
      // Handled via provenance supersessions without synthetic text in AgentMemory
    },
  };
}

function validationStore(provenance: ProvenanceRepository, git: GitRepository | null): ValidationStore {
  return {
    async assess(memoryId) {
      if (!git) return { state: 'UNKNOWN', confidence: 0.25, reasons: ['git_repository_unavailable'] };
      const evidence = provenance.evidenceForMemory(memoryId);
      if (evidence.length === 0) return { state: 'UNKNOWN', confidence: 0.25, reasons: ['memory_has_no_local_provenance'] };
      const changed = new Set((await git.status()).map(({ path: changedPath }) => changedPath.replaceAll('\\', '/')));
      return assessFreshness({ evidence: await Promise.all(evidence.map(async (item) => ({
        path: item.path,
        storedHash: item.blobHash,
        currentHash: await committedBlobHash(git, item.path),
        workingTreeChanged: changed.has(item.path.replaceAll('\\', '/')),
      }))) });
    },
    async record(memoryId, assessment) {
      if (provenance.memoryState(memoryId)) provenance.updateState(memoryId, assessment.state, assessment.confidence, assessment.reasons.join(','));
    },
  };
}

function temporalItems(value: Record<string, unknown>, source: 'agentmemory_memory' | 'agentmemory_session') {
  const arrays = Object.values(value).find(Array.isArray) as unknown[] | undefined;
  return (arrays ?? []).map((item, index) => {
    const record = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      id: String(record.id ?? `${source}-${index}`),
      source,
      occurredAt: String(record.createdAt ?? record.timestamp ?? new Date(0).toISOString()),
      summary: String(record.content ?? record.summary ?? textFromUnknown(item)),
      reference: `${source}:${String(record.id ?? index)}`,
    };
  });
}

export function createApplicationHandlers(dependencies: ApplicationDependencies): MegaBrainToolHandlers {
  const { identity, git, agentMemory, codeReviewGraph, provenance } = dependencies;
  provenance.registerProject({ id: identity.worktreeId, checkoutId: identity.checkoutId, worktreeId: identity.worktreeId, root: identity.root });
  const sources: Partial<Record<RecallSource, RecallSourceAdapter>> = {
    agentmemory: memoryRecall(agentMemory, identity.worktreeId),
    code_review_graph: graphRecall(codeReviewGraph),
    provenance_lexical: lexicalRecall(provenance),
  };
  if (git) sources.git = gitRecall(git);
  return {
    async brain_recall(input) {
      assertProject(input, identity);
      return brainRecall({ query: String(input.query), ...(input.intent ? { intent: input.intent as never } : {}), ...(input.budget ? { budget: input.budget as never } : {}) }, {
        sources, project: identity.worktreeId, head: await currentHead(git),
      });
    },
    async brain_learn(input) {
      assertProject(input, identity);
      const evidence = (input.evidence ?? []) as EvidenceInput[];
      const learned = await brainLearn({
        project: identity.worktreeId,
        head: await currentHead(git),
        statement: String(input.statement),
        type: (input.type ?? 'experience') as KnowledgeType,
        evidence,
        ...(input.supersedes ? { supersedes: String(input.supersedes) } : {}),
      }, learningStore(agentMemory, identity.worktreeId));
      const memoryId = typeof learned.result.memoryId === 'string' ? learned.result.memoryId : null;
      const verifiable = evidence.flatMap((item) => item.blobHash && item.commitHash ? [{
        path: item.path, blobHash: item.blobHash, commitHash: item.commitHash,
        ...(item.symbol ? { symbol: item.symbol } : {}),
      }] : []);
      if (memoryId && verifiable.length > 0) {
        provenance.saveMemoryReference({
          memoryId,
          projectId: identity.worktreeId,
          state: 'FRESH',
          confidence: learned.confidence,
          evidence: verifiable,
          statement: String(input.statement),
          type: String(input.type ?? 'experience'),
        });
      }
      return learned;
    },
    async brain_change_context(input) {
      assertProject(input, identity);
      const target = String(input.target);
      return brainChangeContext({ target, ...(input.budget ? { budget: input.budget as never } : {}) }, {
        project: identity.worktreeId,
        head: await currentHead(git),
        async structure() {
          const [impact, flows, query, flowChain, coChange, symbolCommits] = await Promise.all([
            codeReviewGraph.call('get_impact_radius_tool', { changed_files: [target] }),
            codeReviewGraph.call('get_affected_flows_tool', { changed_files: [target] }),
            codeReviewGraph.call('query_graph_tool', { pattern: 'file_summary', target }),
            codeReviewGraph.call('get_flow_tool', { symbol: target, target }).catch(() => null),
            git ? calculateCoChangeCoupling(git, target, 0.4).catch(() => null) : Promise.resolve(null),
            git ? gitSymbolHistory(git, target, 15).catch(() => []) : Promise.resolve([]),
          ]);
          const baseFlows = stringsFromUnknown(flows.structuredContent ?? flows.content);
          const extraFlows = flowChain ? stringsFromUnknown(flowChain.structuredContent ?? flowChain.content) : [];
          const coChangedFiles = coChange?.coChangedFiles ?? [];
          const symbolChurnCount = symbolCommits.length;
          const isHighFileChurn = coChangedFiles.length > 2 || (coChange?.totalTargetCommits ?? 0) > 10;
          const isHighSymbolChurn = symbolChurnCount > 5;
          const riskWarning = isHighSymbolChurn
            ? `High symbol risk: ${target} modified in ${symbolChurnCount} commits (high churn hotspot)`
            : isHighFileChurn
              ? `High change risk: ${target} has high churn and ${coChangedFiles.length} co-changed files`
              : null;
          return {
            dependencies: stringsFromUnknown(impact.structuredContent ?? impact.content),
            flows: [...baseFlows, ...extraFlows],
            tests: stringsFromUnknown(query.structuredContent ?? query.content),
            coChangedFiles,
            symbolChurnCount,
            ...(riskWarning ? { riskWarning } : {}),
          };
        },
        async experience() {
          const memories = (await agentMemory.smartSearch({ query: target, limit: 20, project: identity.worktreeId })).results;
          const byType = (type: string) => memories.filter(({ metadata }) => metadata?.type === type).flatMap(({ content }) => content ? [content] : []);
          return { rules: byType('rule'), bugs: byType('bug'), decisions: byType('decision'), risks: byType('risk') };
        },
      });
    },
    async brain_history(input) {
      assertProject(input, identity);
      const query = {
        ...(input.query ? { query: String(input.query) } : {}),
        ...(input.anchor ? { anchor: String(input.anchor) } : {}),
        ...(input.symbol ? { symbol: String(input.symbol) } : {}),
        ...(input.start ? { start: String(input.start) } : {}),
        ...(input.end ? { end: String(input.end) } : {}),
        ...(input.limit ? { limit: Number(input.limit) } : {}),
      };
      return brainHistory(query, {
        project: identity.worktreeId,
        head: await currentHead(git),
        commits: async () => git ? (await gitHistory(git, query.limit ?? 50)).map((commit) => ({ id: commit.hash, source: 'git', occurredAt: commit.authoredAt, summary: commit.subject, reference: commit.hash })) : [],
        symbolCommits: async (symbol, limit) => git ? (await gitSymbolHistory(git, symbol, limit ?? 20)).map((commit) => ({ id: commit.hash, source: 'git', occurredAt: commit.authoredAt, summary: `[symbol ${symbol}] ${commit.subject}`, reference: commit.hash })) : [],
        memories: async () => temporalItems(await agentMemory.memories({ project: identity.worktreeId }), 'agentmemory_memory'),
        sessions: async () => temporalItems(await agentMemory.sessions({ project: identity.worktreeId }), 'agentmemory_session'),
        timeline: async (q) => {
          if (!q.anchor) return [];
          try {
            const res = await agentMemory.timeline({ anchor: q.anchor, before: 5, after: 5, project: identity.worktreeId });
            return temporalItems(res as never, 'agentmemory_timeline' as never);
          } catch {
            return [];
          }
        },
        currentStructure: async () => (await codeReviewGraph.call('get_architecture_overview_tool', {})).structuredContent ?? {},
      });
    },
    async brain_validate(input) {
      assertProject(input, identity);
      return brainValidate({ project: identity.worktreeId, head: await currentHead(git), memoryIds: [String(input.memoryId)] }, validationStore(provenance, git));
    },
    async brain_status(input) {
      assertProject(input, identity);
      const head = await currentHead(git);
      const queue = new DurableHookQueue(path.join(dependencies.config.dataDir, 'projects', identity.worktreeId, 'hook-queue.json'));
      const [memory, graph] = await Promise.allSettled([
        agentMemory.health(),
        codeReviewGraph.start().then(() => codeReviewGraph.call('detect_changes_tool', {})),
      ]);
      const graphHead = graph.status === 'fulfilled' && head !== NO_GIT_HEAD
        ? (graph.value.structuredContent?.graphHead ?? graph.value.structuredContent?.graph_head)
        : undefined;
      const memoryCounts = provenance.memoryCountsByState ? provenance.memoryCountsByState() : undefined;
      const status = brainStatus({
        project: identity.worktreeId,
        head,
        ...(typeof graphHead === 'string' ? { graphHead } : {}),
        backends: [
          { name: 'agentmemory', healthy: memory.status === 'fulfilled', version: memory.status === 'fulfilled' ? memory.value.version ?? null : null },
          { name: 'code_review_graph', healthy: graph.status === 'fulfilled', version: codeReviewGraph.serverVersion() },
        ],
        hooksHealthy: Boolean(git) && head !== NO_GIT_HEAD,
        queueDepth: (await queue.pending()).length,
        verbose: Boolean(input.verbose),
        metrics: {
          graphNodeCount: 0,
          memoryCounts: memoryCounts as any,
          retrievalLatencyMs: 0,
        },
      });
      if (!git || head === NO_GIT_HEAD) status.warnings.push('git repository unavailable');
      return status;
    },
  };
}
