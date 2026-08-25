import type { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { probeAgentMemory } from '../adapters/agentmemory/capabilities.js';
import type { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { probeCodeReviewGraphIsolation } from '../adapters/code-review-graph/capabilities.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { redactValue } from '../security/redaction.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';
import { inspectManagedRuntime, type RuntimeInspection } from './install.js';

export interface DoctorDependencies {
  inspect(): Promise<RuntimeInspection>;
  probeAgentMemory(): Promise<{ healthy: boolean; version: string | null; endpoints: readonly string[] }>;
  probeCodeReviewGraph(): Promise<{ healthy: boolean; version: string | null; graphHead: string | null; tools: readonly string[] }>;
  gitHead(): Promise<string>;
}

export interface DoctorOptions {
  project: string;
  hooksHealthy: boolean;
  queueDepth: number;
  config?: Record<string, unknown>;
}

export async function runDoctor(options: DoctorOptions, dependencies: DoctorDependencies): Promise<MegaBrainEnvelope> {
  const [runtime, agentMemory, codeReviewGraph, head] = await Promise.all([
    dependencies.inspect(),
    dependencies.probeAgentMemory(),
    dependencies.probeCodeReviewGraph(),
    dependencies.gitHead(),
  ]);
  const warnings: string[] = [];
  if (!runtime.healthy) warnings.push('managed runtime failed integrity checks');
  if (!agentMemory.healthy) warnings.push('agentmemory unavailable');
  if (!codeReviewGraph.healthy) warnings.push('code_review_graph unavailable');
  if (agentMemory.version && agentMemory.version !== runtime.manifest.versions.agentMemory) warnings.push('agentmemory version mismatch');
  if (codeReviewGraph.graphHead && codeReviewGraph.graphHead !== head) warnings.push('code_review_graph index is behind Git HEAD');
  if (!options.hooksHealthy) warnings.push('hook installation is unhealthy');
  if (options.queueDepth > 0) warnings.push('hook queue has pending events');
  const healthy = warnings.length === 0;
  return createEnvelope({
    runtime: {
      healthy: runtime.healthy,
      checks: runtime.checks,
      versions: runtime.manifest.versions,
      isolation: runtime.manifest.isolation ? {
        worktreeId: runtime.manifest.isolation.worktreeId,
        ports: runtime.manifest.isolation.ports,
        paths: runtime.manifest.isolation.paths,
      } : null,
    },
    backends: {
      agentMemory: { ...agentMemory, authChecked: true },
      codeReviewGraph: { ...codeReviewGraph, schemasChecked: true },
    },
    hooksHealthy: options.hooksHealthy,
    queueDepth: options.queueDepth,
    graphHead: codeReviewGraph.graphHead,
    configuration: redactValue(options.config ?? {}),
  }, {
    status: healthy ? 'ok' : 'degraded',
    project: options.project,
    head,
    confidence: healthy ? 1 : 0.5,
    freshness: codeReviewGraph.graphHead && codeReviewGraph.graphHead !== head ? 'POSSIBLY_STALE' : 'FRESH',
    sources: [
      { kind: 'agentmemory', reference: 'health', authority: 1 },
      { kind: 'code_review_graph', reference: 'mcp-handshake', authority: 1 },
      { kind: 'git', reference: head, authority: 1 },
    ],
    warnings,
  });
}

function findString(value: unknown, keys: Set<string>): string | null {
  if (value === null || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof item === 'string') return item;
    const nested = findString(item, keys);
    if (nested) return nested;
  }
  return null;
}

export function managedDoctorDependencies(input: {
  dataDir: string;
  identity: ProjectIdentity;
  agentMemory: AgentMemoryClient;
  codeReviewGraph: CodeReviewGraphClient;
  gitHead(): Promise<string>;
}): DoctorDependencies {
  return {
    inspect: () => inspectManagedRuntime(input.dataDir, input.identity),
    async probeAgentMemory() {
      try { return await probeAgentMemory(input.agentMemory); }
      catch { return { healthy: false, version: null, endpoints: [] }; }
    },
    async probeCodeReviewGraph() {
      const storage = probeCodeReviewGraphIsolation(input.codeReviewGraph, input.identity.root);
      await input.codeReviewGraph.start();
      const changes = await input.codeReviewGraph.call('detect_changes_tool', {});
      return {
        healthy: true,
        version: input.codeReviewGraph.serverVersion(),
        graphHead: findString(changes.structuredContent, new Set(['graphHead', 'graph_head', 'indexedCommit', 'indexed_commit', 'commitHash', 'commit_hash'])),
        tools: input.codeReviewGraph.tools(),
        storage,
      };
    },
    gitHead: input.gitHead,
  };
}
