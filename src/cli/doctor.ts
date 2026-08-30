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

export type DiagnosticProbeState = 'ok' | 'failed' | 'unknown' | 'mismatch' | 'partial' | 'not_applicable' | 'not_configured';
export type ComponentHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'not_applicable' | 'not_configured';

export interface AgentMemoryProbeResult {
  status?: ComponentHealthStatus;
  healthy: boolean;
  version: string | { status: DiagnosticProbeState; detected: string | null; expected: string | null } | null;
  endpoints: readonly string[];
  process?: DiagnosticProbeState;
  endpoint?: DiagnosticProbeState;
  capabilities?: DiagnosticProbeState;
  authChecked?: boolean;
  lifecycle?: 'temporary probe' | 'daemon' | 'not applicable';
}

export interface CodeReviewGraphProbeResult {
  status?: ComponentHealthStatus;
  healthy: boolean;
  version: string | { status: DiagnosticProbeState; detected: string | null; expected: string | null } | null;
  graphHead?: string | null;
  tools: readonly string[];
  process?: DiagnosticProbeState;
  endpoint?: DiagnosticProbeState;
  capabilities?: DiagnosticProbeState;
  storage?: unknown;
  schemasChecked?: boolean;
  lifecycle?: 'temporary probe' | 'on-demand' | 'not applicable';
}

export interface DoctorDependencies {
  inspect(): Promise<RuntimeInspection>;
  probeAgentMemory(): Promise<AgentMemoryProbeResult>;
  probeCodeReviewGraph(): Promise<CodeReviewGraphProbeResult>;
  gitHead(): Promise<string>;
  gitAvailable?: (() => Promise<boolean>) | undefined;
}

export interface DoctorOptions {
  project: string;
  provisioned?: boolean;
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
  const isProvisioned = options.provisioned ?? (options.project !== 'Not provisioned');
  const [runtime, agentMemory, codeReviewGraph, head, isGitAvailable] = await Promise.all([
    dependencies.inspect(),
    dependencies.probeAgentMemory(),
    dependencies.probeCodeReviewGraph(),
    dependencies.gitHead(),
    dependencies.gitAvailable ? dependencies.gitAvailable() : Promise.resolve(true),
  ]);
  const warnings: string[] = [];

  if (isProvisioned) {
    if (!runtime.healthy) warnings.push('managed runtime failed integrity checks or is not installed');
    if (agentMemory.status !== 'not_configured' && agentMemory.status !== 'not_applicable' && !agentMemory.healthy) {
      warnings.push('agentmemory unavailable');
    }
    if (codeReviewGraph.status !== 'not_configured' && codeReviewGraph.status !== 'not_applicable' && !codeReviewGraph.healthy) {
      warnings.push('code_review_graph unavailable');
    }
    const amVersionStr = typeof agentMemory.version === 'object' && agentMemory.version !== null ? agentMemory.version.detected : agentMemory.version;
    if (amVersionStr && runtime.manifest?.versions?.agentMemory && amVersionStr !== runtime.manifest.versions.agentMemory) {
      warnings.push('agentmemory version mismatch');
    }
    if (codeReviewGraph.graphHead && head !== NO_GIT_HEAD && codeReviewGraph.graphHead !== head) {
      warnings.push('code_review_graph index is behind Git HEAD');
    }
  }

  if (!isGitAvailable) warnings.push('git repository unavailable');
  if (!options.hooksHealthy) warnings.push('hook installation is unhealthy');
  if (options.queueDepth > 0) warnings.push('hook queue has pending events');
  const healthy = warnings.length === 0;

  const resolvedAmStatus: ComponentHealthStatus = !isProvisioned
    ? 'not_applicable'
    : (agentMemory.status ?? (agentMemory.healthy ? 'healthy' : 'unavailable'));

  const resolvedCrgStatus: ComponentHealthStatus = !isProvisioned
    ? 'not_applicable'
    : (codeReviewGraph.status ?? (codeReviewGraph.healthy ? 'healthy' : 'unavailable'));

  return createEnvelope({
    provisioned: isProvisioned,
    runtime: {
      healthy: isProvisioned ? runtime.healthy : true,
      checks: runtime.checks,
      versions: runtime.manifest.versions,
      isolation: runtime.manifest.isolation ? {
        worktreeId: runtime.manifest.isolation.worktreeId,
        ports: runtime.manifest.isolation.ports,
        paths: runtime.manifest.isolation.paths,
      } : null,
    },
    backends: {
      agentMemory: {
        ...agentMemory,
        status: resolvedAmStatus,
        authChecked: isProvisioned ? (agentMemory.authChecked ?? true) : false,
      },
      codeReviewGraph: {
        ...codeReviewGraph,
        status: resolvedCrgStatus,
        schemasChecked: isProvisioned ? (codeReviewGraph.schemasChecked ?? true) : false,
      },
    },
    hooksHealthy: options.hooksHealthy,
    queueDepth: options.queueDepth,
    graphHead: codeReviewGraph.graphHead,
    configuration: redactValue(options.config ?? {}),
  }, {
    status: healthy ? 'ok' : 'degraded',
    project: isProvisioned ? options.project : 'Not provisioned',
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
  if (typeof value === 'object') {
    if ('detected' in (value as Record<string, unknown>)) {
      const v = (value as { detected: unknown }).detected;
      return v ? String(v) : pc.dim('n/a');
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function shortHead(head: string): string {
  return head === NO_GIT_HEAD ? pc.dim('none') : head.slice(0, 8);
}

function checkText(healthy: boolean, okLabel = 'OK', failLabel = 'Degraded'): string {
  return healthy ? `${pc.green(cliIcons.check)} ${okLabel}` : `${pc.red(cliIcons.cross)} ${failLabel}`;
}

function statusText(status: ComponentHealthStatus, fallbackHealthy = true): string {
  switch (status) {
    case 'healthy': return `${pc.green(cliIcons.check)} Healthy`;
    case 'degraded': return `${pc.yellow(cliIcons.info)} Degraded`;
    case 'unavailable': return `${pc.red(cliIcons.cross)} Unavailable`;
    case 'not_applicable': return `${pc.dim('○')} Not applicable`;
    case 'not_configured': return `${pc.dim('○')} Not configured`;
    default: return checkText(fallbackHealthy, 'Healthy', 'Unavailable');
  }
}

function staleText(fresh: boolean): string {
  return fresh ? `${pc.green(cliIcons.check)} Fresh` : `${pc.yellow(cliIcons.info)} Stale`;
}

function warningSection(warnings: readonly string[]): string {
  if (warnings.length === 0) return `${pc.bold(pc.cyan('Warnings'))}\n${pc.green(cliIcons.check)} No warnings detected`;
  return `${pc.bold(pc.cyan('Warnings'))}\n${warnings.map((w) => `  ${pc.red(cliIcons.cross)} ${w}`).join('\n')}`;
}

function section(title: string, content: string): string {
  return `${pc.bold(pc.cyan(title))}\n${content}`;
}

function configurationRows(configuration: Record<string, unknown>): Array<readonly [string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(configuration)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
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
  const runtime = nestedRecord(result, 'runtime');
  const runtimeChecks = nestedRecord(runtime, 'checks');
  const isolation = nestedRecord(runtime, 'isolation');
  const versions = nestedRecord(runtime, 'versions');
  const backends = nestedRecord(result, 'backends');
  const agentMemory = nestedRecord(backends, 'agentMemory') as unknown as AgentMemoryProbeResult;
  const codeReviewGraph = nestedRecord(backends, 'codeReviewGraph') as unknown as CodeReviewGraphProbeResult;
  const ports = nestedRecord(isolation, 'ports');
  const paths = nestedRecord(isolation, 'paths');
  const configuration = nestedRecord(result, 'configuration');
  const queueDepth = typeof result.queueDepth === 'number' ? result.queueDepth : 0;
  const graphHead = typeof result.graphHead === 'string' ? result.graphHead : null;
  const graphStale = envelope.freshness === 'FRESH';
  const crgTools = Array.isArray(codeReviewGraph.tools) ? codeReviewGraph.tools : [];
  const crgToolCount = crgTools.length;
  const isProvisioned = result.provisioned !== false && envelope.project !== 'Not provisioned';

  const overview = formatTerminalTable(['Check', 'Result'], [
    ['Overall status', envelope.status === 'ok' ? `${pc.green(cliIcons.check)} Healthy` : `${pc.red(cliIcons.cross)} Degraded`],
    ['Project', envelope.project === 'Not provisioned' ? pc.dim('Not provisioned') : String(envelope.project ?? '')],
    ['Git HEAD', shortHead(envelope.head ?? '')],
    ['Freshness', staleText(graphStale)],
    ['Confidence', `${Math.round(envelope.confidence * 100)}%`],
    ['Warnings', envelope.warnings.length === 0 ? `${pc.green(cliIcons.check)} None` : `${pc.red(cliIcons.cross)} ${envelope.warnings.length}`],
  ]);

  const amStatus = (agentMemory.status as ComponentHealthStatus) ?? (agentMemory.healthy ? 'healthy' : 'unavailable');
  const crgStatus = (codeReviewGraph.status as ComponentHealthStatus) ?? (codeReviewGraph.healthy ? 'healthy' : 'unavailable');

  const amDetails = !isProvisioned
    ? 'unprovisioned directory'
    : amStatus === 'not_configured'
      ? 'backend not configured'
      : `version ${valueText(agentMemory.version)}; auth ${agentMemory.authChecked ? 'checked' : 'not checked'}${agentMemory.lifecycle ? `; ${agentMemory.lifecycle}` : ''}`;

  const crgDetails = !isProvisioned
    ? 'unprovisioned directory'
    : crgStatus === 'not_configured'
      ? 'backend not configured'
      : `version ${valueText(codeReviewGraph.version)}; ${crgToolCount} tools${codeReviewGraph.lifecycle ? `; ${codeReviewGraph.lifecycle}` : ''}`;

  const health = formatTerminalTable(['Component', 'Status', 'Details'], [
    ['Runtime', !isProvisioned ? `${pc.dim('○')} Not applicable` : checkText(Boolean(runtime.healthy)), !isProvisioned ? 'unprovisioned directory' : `${Object.keys(runtimeChecks).length} integrity checks`],
    ['AgentMemory', statusText(amStatus, Boolean(agentMemory.healthy)), amDetails],
    ['Code Review Graph', statusText(crgStatus, Boolean(codeReviewGraph.healthy)), crgDetails],
    ['Git repository', envelope.head === NO_GIT_HEAD ? checkText(false, 'Available', 'Unavailable') : checkText(true, 'Available'), shortHead(envelope.head ?? '')],
    ['Host hooks', checkText(Boolean(result.hooksHealthy)), Boolean(result.hooksHealthy) ? 'configured' : 'needs attention'],
    ['Hook queue', queueDepth === 0 ? checkText(true, 'Empty') : `${pc.red(cliIcons.cross)} ${queueDepth} pending`, 'pending lifecycle events'],
    ['Graph index', !isProvisioned ? `${pc.dim('○')} Not applicable` : staleText(graphStale), !isProvisioned ? 'unprovisioned directory' : graphHead ? `${shortHead(graphHead)} indexed` : 'graph head unavailable'],
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
  gitAvailable?: (() => Promise<boolean>) | undefined;
  provisioned?: boolean;
}): DoctorDependencies {
  const isProvisioned = input.provisioned ?? true;
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
            versions: { megaBrain: '0.1.6', agentMemory: 'uninstalled', codeReviewGraph: 'uninstalled' },
            backends: { codeReviewGraph: { command: '', args: [], cwd: input.identity.root, lifecycle: 'on-demand' } },
          },
        };
      } 
    },
    async probeAgentMemory(): Promise<AgentMemoryProbeResult> {
      if (!isProvisioned) {
        return { status: 'not_applicable', healthy: true, version: null, endpoints: [], lifecycle: 'not applicable' };
      }
      try {
        const probed = await probeAgentMemory(input.agentMemory);
        return {
          status: probed.healthy ? 'healthy' : 'unavailable',
          healthy: probed.healthy,
          version: probed.version,
          endpoints: probed.endpoints,
          process: probed.healthy ? 'ok' : 'failed',
          endpoint: probed.healthy ? 'ok' : 'failed',
          capabilities: probed.healthy ? 'ok' : 'failed',
          authChecked: true,
          lifecycle: 'temporary probe',
        };
      } catch {
        return {
          status: 'unavailable',
          healthy: false,
          version: null,
          endpoints: [],
          process: 'failed',
          endpoint: 'failed',
          capabilities: 'failed',
          authChecked: false,
          lifecycle: 'temporary probe',
        };
      }
    },
    async probeCodeReviewGraph(): Promise<CodeReviewGraphProbeResult> {
      if (!isProvisioned) {
        return { status: 'not_applicable', healthy: true, version: null, graphHead: null, tools: [], lifecycle: 'not applicable' };
      }
      try {
        const storage = probeCodeReviewGraphIsolation(input.codeReviewGraph, input.identity.root);
        await input.codeReviewGraph.start();
        try {
          const changes = await input.codeReviewGraph.call('detect_changes_tool', {});
          const tools = input.codeReviewGraph.tools();
          const version = input.codeReviewGraph.serverVersion();
          return {
            status: 'healthy',
            healthy: true,
            version,
            graphHead: findString(changes.structuredContent, new Set(['graphHead', 'graph_head', 'indexedCommit', 'indexed_commit', 'commitHash', 'commit_hash'])),
            tools,
            process: 'ok',
            endpoint: 'ok',
            capabilities: 'ok',
            storage,
            schemasChecked: true,
            lifecycle: 'temporary probe',
          };
        } finally {
          await input.codeReviewGraph.stop().catch(() => undefined);
        }
      } catch {
        return {
          status: 'unavailable',
          healthy: false,
          version: null,
          graphHead: null,
          tools: [],
          process: 'failed',
          endpoint: 'failed',
          capabilities: 'failed',
          storage: null,
          schemasChecked: false,
          lifecycle: 'temporary probe',
        };
      }
    },
    gitHead: input.gitHead,
    gitAvailable: input.gitAvailable,
  };
}
