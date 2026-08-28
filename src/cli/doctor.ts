import path from 'node:path';

import pc from 'picocolors';

import type { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { probeAgentMemory } from '../adapters/agentmemory/capabilities.js';
import type { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { probeCodeReviewGraphIsolation } from '../adapters/code-review-graph/capabilities.js';
import { NO_GIT_HEAD } from '../adapters/git/repository.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { drainPendingDeletes } from '../runtime/pending-deletes.js';
import { sweepRuntimeProcesses } from '../runtime/process-tree.js';
import type { RuntimeLayout } from '../runtime/layout.js';
import { redactValue } from '../security/redaction.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';
import { inspectManagedRuntime, type RuntimeInspection } from './install.js';
import { cliIcons, formatTerminalTable } from './ui.js';

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

export async function runDoctorFix(input: {
  dataDir: string;
  identity: ProjectIdentity;
  layout: RuntimeLayout;
}): Promise<{ purged: string[]; swept: number[] }> {
  const drained = await drainPendingDeletes(input.dataDir);
  const swept = await sweepRuntimeProcesses(input.layout.runtimeRoot).catch(() => []);
  return { purged: drained.purged, swept };
}

export async function runDoctor(options: DoctorOptions, dependencies: DoctorDependencies): Promise<MegaBrainEnvelope> {
  const [runtime, agentMemory, codeReviewGraph, head] = await Promise.all([
    dependencies.inspect(),
    dependencies.probeAgentMemory(),
    dependencies.probeCodeReviewGraph(),
    dependencies.gitHead(),
  ]);
  const warnings: string[] = [];
  if (!runtime.healthy) warnings.push('managed runtime failed integrity checks or is not installed');
  if (!agentMemory.healthy) warnings.push('agentmemory unavailable');
  if (!codeReviewGraph.healthy) warnings.push('code_review_graph unavailable');
  if (agentMemory.version && agentMemory.version !== runtime.manifest.versions.agentMemory) warnings.push('agentmemory version mismatch');
  if (codeReviewGraph.graphHead && head !== NO_GIT_HEAD && codeReviewGraph.graphHead !== head) warnings.push('code_review_graph index is behind Git HEAD');
  if (head === NO_GIT_HEAD) warnings.push('git repository unavailable');
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
    freshness: codeReviewGraph.graphHead && head !== NO_GIT_HEAD && codeReviewGraph.graphHead !== head ? 'POSSIBLY_STALE' : 'FRESH',
    sources: [
      { kind: 'agentmemory', reference: 'health', authority: 1 },
      { kind: 'code_review_graph', reference: 'mcp-handshake', authority: 1 },
      { kind: 'git', reference: head, authority: 1 },
    ],
    warnings,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  return asRecord(asRecord(value)[key]);
}

function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return pc.dim('n/a');
  if (typeof value === 'boolean') return value ? pc.green('enabled') : pc.dim('off');
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : pc.dim('none');
  if (typeof value === 'object') return JSON.stringify(redactValue(value));
  return String(value);
}

function checkText(value: boolean, positive = 'OK', negative = 'Degraded'): string {
  return value ? `${pc.green(cliIcons.check)} ${positive}` : `${pc.red(cliIcons.cross)} ${negative}`;
}

function staleText(value: boolean): string {
  return value ? `${pc.yellow(cliIcons.cross)} Stale` : `${pc.green(cliIcons.check)} Fresh`;
}

function shortHead(value: string | null | undefined): string {
  if (!value || value === NO_GIT_HEAD) return pc.dim('none');
  return value.slice(0, 8);
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number') return pc.dim('n/a');
  return `${Math.round(value * 100)}%`;
}

function section(title: string, content: string): string {
  return `${pc.bold(pc.cyan(title))}\n${content}`;
}

function warningSection(warnings: string[]): string {
  if (warnings.length === 0) return `${pc.bold(pc.cyan('Warnings'))}\n${pc.green(cliIcons.check)} No warnings detected`;
  return `${pc.bold(pc.yellow('Warnings'))}\n${warnings.map((warning) => `  ${pc.yellow(cliIcons.cross)} ${warning}`).join('\n')}`;
}

function configurationRows(config: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        rows.push([`${key}.${nestedKey}`, valueText(nestedValue)]);
      }
    } else {
      rows.push([key, valueText(value)]);
    }
  }
  return rows;
}

export function formatDoctorReport(envelope: MegaBrainEnvelope): string {
  const result = asRecord(envelope.result);
  const runtime = asRecord(result.runtime);
  const backends = asRecord(result.backends);
  const agentMemory = asRecord(backends.agentMemory);
  const codeReviewGraph = asRecord(backends.codeReviewGraph);
  const versions = nestedRecord(result.runtime, 'versions');
  const isolation = nestedRecord(result.runtime, 'isolation');
  const ports = nestedRecord(isolation, 'ports');
  const paths = nestedRecord(isolation, 'paths');
  const runtimeChecks = nestedRecord(result.runtime, 'checks');
  const queueDepth = typeof result.queueDepth === 'number' ? result.queueDepth : 0;
  const graphHead = typeof result.graphHead === 'string' ? result.graphHead : null;
  const crgTools = Array.isArray(codeReviewGraph.tools) ? codeReviewGraph.tools : [];
  const crgToolCount = crgTools.length;
  const configuration = asRecord(result.configuration);
  const graphStale = Boolean(graphHead && envelope.head !== NO_GIT_HEAD && envelope.head !== graphHead);

  const overview = formatTerminalTable(['Check', 'Result'], [
    ['Overall status', envelope.status === 'ok' ? checkText(true, 'Healthy') : checkText(false, 'Healthy', 'Degraded')],
    ['Project', valueText(envelope.project)],
    ['Git HEAD', shortHead(envelope.head)],
    ['Freshness', envelope.freshness === 'FRESH' ? checkText(true, 'FRESH') : checkText(false, 'FRESH', envelope.freshness)],
    ['Confidence', formatPercent(envelope.confidence)],
    ['Warnings', envelope.warnings.length === 0 ? checkText(true, 'None') : checkText(false, 'None', String(envelope.warnings.length))],
  ]);

  const health = formatTerminalTable(['Component', 'Status', 'Details'], [
    ['Runtime', checkText(Boolean(runtime.healthy)), `${Object.keys(runtimeChecks).length} integrity checks`],
    ['AgentMemory', checkText(Boolean(agentMemory.healthy), 'Healthy', 'Unavailable'), `version ${valueText(agentMemory.version)}; auth ${agentMemory.authChecked ? 'checked' : 'not checked'}`],
    ['Code Review Graph', checkText(Boolean(codeReviewGraph.healthy), 'Healthy', 'Unavailable'), `version ${valueText(codeReviewGraph.version)}; ${crgToolCount} tools`],
    ['Git repository', envelope.head === NO_GIT_HEAD ? checkText(false, 'Available', 'Unavailable') : checkText(true, 'Available'), shortHead(envelope.head)],
    ['Host hooks', checkText(Boolean(result.hooksHealthy)), Boolean(result.hooksHealthy) ? 'configured' : 'needs attention'],
    ['Hook queue', queueDepth === 0 ? checkText(true, 'Empty') : `${pc.red(cliIcons.cross)} ${queueDepth} pending`, 'pending lifecycle events'],
    ['Graph index', staleText(graphStale), graphHead ? `${shortHead(graphHead)} indexed` : 'graph head unavailable'],
  ]);

  const runtimeDetails = formatTerminalTable(['Runtime', 'Value'], [
    ['Worktree ID', valueText(isolation?.worktreeId)],
    ...Object.entries(versions).map(([name, version]) => [name, valueText(version)] as const),
    ...Object.entries(runtimeChecks).map(([name, value]) => [`check:${name}`, checkText(Boolean(value))] as const),
  ]);

  const portDetails = Object.keys(ports).length > 0
    ? section('Ports', formatTerminalTable(['Port', 'Value'], Object.entries(ports).map(([name, value]) => [name, valueText(value)] as const)))
    : `${pc.bold(pc.cyan('Ports'))}\n${pc.dim('No isolated ports reported')}`;

  const pathDetails = Object.keys(paths).length > 0
    ? section('Paths', formatTerminalTable(['Path', 'Value'], Object.entries(paths).map(([name, value]) => [name, valueText(value)] as const)))
    : `${pc.bold(pc.cyan('Paths'))}\n${pc.dim('No isolated paths reported')}`;

  const backendDetails = formatTerminalTable(['Backend', 'Probe details'], [
    ['AgentMemory endpoints', valueText(agentMemory.endpoints)],
    ['Code Review Graph tools', valueText(codeReviewGraph.tools)],
    ['Code Review Graph storage', valueText(codeReviewGraph.storage)],
  ]);

  return [
    pc.bold(pc.cyan('Mega Brain doctor')),
    section('Overview', overview),
    section('Health checks', health),
    section('Runtime', runtimeDetails),
    portDetails,
    pathDetails,
    section('Backends', backendDetails),
    section('Configuration', formatTerminalTable(['Setting', 'Value'], configurationRows(configuration))),
    warningSection(envelope.warnings),
  ].join('\n\n');
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
    inspect: async () => {
      try {
        return await inspectManagedRuntime(input.dataDir, input.identity);
      } catch {
        return {
          healthy: false,
          checks: { installed: false },
          manifest: {
            schemaVersion: 1,
            installedAt: '',
            agentMemoryMode: 'managed',
            project: { repositoryId: input.identity.repositoryId, checkoutId: input.identity.checkoutId, worktreeId: input.identity.worktreeId },
            versions: { megaBrain: '0.1.5', agentMemory: 'uninstalled', codeReviewGraph: 'uninstalled' },
            backends: { codeReviewGraph: { command: '', args: [], cwd: input.identity.root, lifecycle: 'on-demand' } },
          },
        };
      }
    },
    async probeAgentMemory() {
      try { return await probeAgentMemory(input.agentMemory); }
      catch { return { healthy: false, version: null, endpoints: [] }; }
    },
    async probeCodeReviewGraph() {
      try {
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
      } catch {
        return {
          healthy: false,
          version: null,
          graphHead: null,
          tools: [],
          storage: null,
        };
      }
    },
    gitHead: input.gitHead,
  };
}