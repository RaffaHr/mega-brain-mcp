import pc from 'picocolors';

import { redactText } from '../security/redaction.js';

import type { LocalLogger, LogLevel } from '../observability/logger.js';
import type { ProjectIdentity } from '../projects/identity.js';
import type { RuntimeLockManifest } from '../runtime/lock-manifest.js';
import type { RuntimeInspection } from './install.js';
import { cliIcons, cliMuted, formatTerminalTable } from './ui.js';
import type { SetupHost } from './setup.js';

export type OperationStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface OperationStep {
  id: string;
  label: string;
  status?: OperationStepStatus | undefined;
  detail?: string | undefined;
  error?: string | undefined;
}

export interface OperationLogMatch {
  message: string;
  stepId: string;
  detail?(fields: Record<string, unknown>): string | undefined;
  complete?: boolean | undefined;
}

export interface OperationProgress {
  start(stepId: string, detail?: string): void;
  succeed(stepId: string, detail?: string): void;
  fail(stepId: string, error: unknown): void;
  skip(stepId: string, detail?: string): void;
  run<T>(stepId: string, task: () => Promise<T>, detail?: string): Promise<T>;
  logger(matches: readonly OperationLogMatch[], parent?: LocalLogger): LocalLogger;
  completeOpenSteps(detail?: string): void;
  close(): void;
  snapshot(): OperationStep[];
}

const spinnerFrames = ['◐', '◓', '◑', '◒'] as const;

function stringifyError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function visibleWidth(value: string): number {
  return Array.from(value.replace(/\x1b\[[0-9;]*m/gu, '')).length;
}

function statusCell(step: OperationStep, frame: number): string {
  if (step.status === 'running') return `${pc.cyan(spinnerFrames[frame])} Running`;
  if (step.status === 'success') return `${pc.green(cliIcons.check)} Done`;
  if (step.status === 'error') return `${pc.red(cliIcons.cross)} Error`;
  if (step.status === 'skipped') return `${pc.dim('skip')}`;
  return pc.dim('pending');
}

function stepDetail(step: OperationStep): string {
  if (step.error) return step.error;
  return step.detail ?? '';
}

function renderProgress(title: string, steps: readonly OperationStep[], frame: number): string {
  return [
    pc.bold(pc.cyan(title)),
    formatTerminalTable(
      ['Step', 'Status', 'Details'],
      steps.map((step) => [step.label, statusCell(step, frame), stepDetail(step)]),
    ),
  ].join('\n');
}

function renderPlainStep(step: OperationStep): string {
  const marker = step.status === 'running'
    ? pc.cyan('>')
    : step.status === 'success'
      ? pc.green(cliIcons.check)
      : step.status === 'error'
        ? pc.red(cliIcons.cross)
        : step.status === 'skipped'
          ? pc.dim('-')
          : pc.dim(' ');
  return `${marker} ${step.label}${stepDetail(step) ? cliMuted(` - ${stepDetail(step)}`) : ''}`;
}

export function createOperationProgress(input: {
  title: string;
  steps: readonly OperationStep[];
  output?: NodeJS.WriteStream;
  enabled?: boolean;
}): OperationProgress {
  const output = input.output ?? process.stderr;
  const enabled = input.enabled ?? true;
  const steps = input.steps.map((step) => ({ ...step, status: step.status ?? 'pending' }));
  let frame = 0;
  let renderedLines = 0;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const findStep = (stepId: string): OperationStep | undefined => steps.find((step) => step.id === stepId);

  const writeProgress = () => {
    if (!enabled || closed) return;
    if (!output.isTTY) return;
    const rendered = renderProgress(input.title, steps, frame);
    if (renderedLines > 0) output.write(`\x1b[${renderedLines}F\x1b[J`);
    output.write(`${rendered}\n`);
    renderedLines = rendered.split('\n').length + 1;
  };

  const writePlain = (step: OperationStep) => {
    if (!enabled || closed || output.isTTY) return;
    output.write(`${renderPlainStep(step)}\n`);
  };

  const touch = (step: OperationStep) => {
    writePlain(step);
    writeProgress();
  };

  const completeRunningBefore = (stepId: string) => {
    for (const step of steps) {
      if (step.id !== stepId && step.status === 'running') step.status = 'success';
    }
  };

  if (enabled && output.isTTY) {
    writeProgress();
    timer = setInterval(() => {
      frame = (frame + 1) % spinnerFrames.length;
      if (steps.some((step) => step.status === 'running')) writeProgress();
    }, 120);
    timer.unref();
  }

  const progress: OperationProgress = {
    start(stepId, detail) {
      const step = findStep(stepId);
      if (!step || step.status === 'success') return;
      completeRunningBefore(stepId);
      step.status = 'running';
      step.detail = detail ?? step.detail;
      step.error = undefined;
      touch(step);
    },
    succeed(stepId, detail) {
      const step = findStep(stepId);
      if (!step || step.status === 'success') return;
      step.status = 'success';
      step.detail = detail ?? step.detail;
      step.error = undefined;
      touch(step);
    },
    fail(stepId, error) {
      const step = findStep(stepId);
      if (!step) return;
      step.status = 'error';
      step.error = stringifyError(error);
      touch(step);
    },
    skip(stepId, detail) {
      const step = findStep(stepId);
      if (!step || step.status === 'success') return;
      step.status = 'skipped';
      step.detail = detail ?? step.detail;
      step.error = undefined;
      touch(step);
    },
    async run(stepId, task, detail) {
      progress.start(stepId, detail);
      try {
        const result = await task();
        progress.succeed(stepId);
        return result;
      } catch (error) {
        progress.fail(stepId, error);
        throw error;
      }
    },
    logger(matches, parent) {
      return {
        log(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
          parent?.log(level, message, fields);
          const match = matches.find((candidate) => message.includes(candidate.message));
          if (!match) return;
          const detail = match.detail?.(fields);
          if (match.complete) {
            completeRunningBefore(match.stepId);
            progress.succeed(match.stepId, detail);
          } else {
            progress.start(match.stepId, detail);
          }
        },
      };
    },
    completeOpenSteps(detail) {
      for (const step of steps) {
        if (step.status === 'running' || step.status === 'pending') {
          step.status = 'success';
          step.detail = detail ?? step.detail;
        }
      }
      writeProgress();
    },
    close() {
      closed = true;
      if (timer) clearInterval(timer);
      if (enabled && output.isTTY && renderedLines > 0) output.write('\n');
    },
    snapshot() {
      return steps.map((step) => ({ ...step }));
    },
  };

  return progress;
}

function formatOperationStatus(status: OperationStepStatus | undefined): string {
  if (status === 'success') return `${pc.green(cliIcons.check)} OK`;
  if (status === 'error') return `${pc.red(cliIcons.cross)} Error`;
  if (status === 'skipped') return pc.dim('Skipped');
  if (status === 'running') return `${pc.cyan('>')} Running`;
  return pc.dim('Pending');
}

export function formatStepReport(title: string, steps: readonly OperationStep[], footer?: string): string {
  const rows = steps.map((step) => [
    step.label,
    formatOperationStatus(step.status),
    step.error ?? step.detail ?? '',
  ]);
  return [
    pc.bold(pc.cyan(title)),
    formatTerminalTable(['Item', 'Status', 'Details'], rows),
    ...(footer ? [footer] : []),
  ].join('\n');
}

export const installLogMatches: readonly OperationLogMatch[] = [
  { message: 'probing remote AgentMemory isolation', stepId: 'remote-probe' },
  { message: 'checking prerequisites', stepId: 'preflight' },
  { message: 'draining existing runtime before swap', stepId: 'runtime-drain' },
  { message: 'preparing isolated runtime directories', stepId: 'prepare-runtime' },
  { message: 'installing iii-engine artifact', stepId: 'iii-engine', detail: (fields) => String(fields.version ?? '') },
  { message: 'installing AgentMemory packages', stepId: 'agentmemory', detail: (fields) => String(fields.version ?? '') },
  { message: 'creating Code Review Graph virtualenv', stepId: 'crg-venv' },
  { message: 'installing Code Review Graph package', stepId: 'crg-package', detail: (fields) => String(fields.version ?? '') },
  { message: 'building Code Review Graph index', stepId: 'crg-index' },
  { message: 'activating staged runtime', stepId: 'activate-runtime' },
  { message: 'restarting previously active runtime after swap', stepId: 'runtime-restart' },
  { message: 'runtime installation complete', stepId: 'runtime-installed', complete: true },
];

export const upgradeLogMatches: readonly OperationLogMatch[] = [
  { message: 'probing remote AgentMemory isolation', stepId: 'remote-probe' },
  { message: 'checking prerequisites', stepId: 'preflight' },
  { message: 'draining existing runtime before swap', stepId: 'runtime-drain' },
  { message: 'preparing isolated runtime directories', stepId: 'prepare-runtime' },
  { message: 'installing iii-engine artifact', stepId: 'iii-engine', detail: (fields) => String(fields.version ?? '') },
  { message: 'installing AgentMemory packages', stepId: 'agentmemory', detail: (fields) => String(fields.version ?? '') },
  { message: 'creating Code Review Graph virtualenv', stepId: 'crg-venv' },
  { message: 'installing Code Review Graph package', stepId: 'crg-package', detail: (fields) => String(fields.version ?? '') },
  { message: 'building Code Review Graph index', stepId: 'crg-index' },
  { message: 'activating staged runtime', stepId: 'activate-runtime' },
  { message: 'restarting previously active runtime after swap', stepId: 'runtime-restart' },
  { message: 'runtime installation complete', stepId: 'inspect-runtime', complete: true },
];

export const uninstallLogMatches: readonly OperationLogMatch[] = [
  { message: 'draining project runtime', stepId: 'runtime-drain' },
  { message: 'restoring host integrations', stepId: 'host-hooks' },
  { message: 'quarantining runtime', stepId: 'runtime-remove' },
  { message: 'removing runtime state and project config', stepId: 'project-config' },
  { message: 'purging project data', stepId: 'project-data' },
  { message: 'integration cleanup complete', stepId: 'project-config', complete: true },
];

export function installSteps(input: {
  agentMemoryMode: 'managed' | 'remote';
  managedIiiEngineRequired: boolean;
  managedCodeReviewGraph: boolean;
  repository: boolean;
  preflightDetail?: string;
}): OperationStep[] {
  return [
    { id: 'preflight', label: 'Preflight', status: 'success', detail: input.preflightDetail },
    ...(input.agentMemoryMode === 'remote' ? [{ id: 'remote-probe', label: 'Remote AgentMemory probe' }] : []),
    { id: 'prepare-runtime', label: 'Prepare runtime' },
    ...(input.managedIiiEngineRequired ? [{ id: 'iii-engine', label: 'iii-engine' }] : []),
    ...(input.agentMemoryMode === 'managed' ? [{ id: 'agentmemory', label: 'AgentMemory packages' }] : []),
    ...(input.managedCodeReviewGraph ? [
      { id: 'crg-venv', label: 'Code Review Graph virtualenv' },
      { id: 'crg-package', label: 'Code Review Graph package' },
    ] : []),
    { id: 'crg-index', label: 'Code Review Graph index' },
    { id: 'runtime-drain', label: 'Drain previous runtime', status: 'skipped', detail: 'only when an installed runtime is active' },
    { id: 'activate-runtime', label: 'Activate runtime' },
    { id: 'runtime-restart', label: 'Restart runtime', status: 'skipped', detail: 'only when it was active before install' },
    { id: 'runtime-installed', label: 'Install runtime' },
    { id: 'mcp-files', label: 'Configure MCP files' },
    { id: 'host-hooks', label: 'Configure host hooks' },
    ...(input.repository ? [{ id: 'git-hooks', label: 'Configure Git hooks' }] : []),
    { id: 'verify-install', label: 'Verify installation' },
  ];
}

export function upgradeSteps(input: {
  agentMemoryMode: 'managed' | 'remote';
  managedIiiEngineRequired: boolean;
  managedCodeReviewGraph: boolean;
}): OperationStep[] {
  return [
    { id: 'preflight', label: 'Preflight' },
    ...(input.agentMemoryMode === 'remote' ? [{ id: 'remote-probe', label: 'Remote AgentMemory probe' }] : []),
    { id: 'prepare-runtime', label: 'Prepare runtime' },
    ...(input.managedIiiEngineRequired ? [{ id: 'iii-engine', label: 'iii-engine' }] : []),
    ...(input.agentMemoryMode === 'managed' ? [{ id: 'agentmemory', label: 'AgentMemory packages' }] : []),
    ...(input.managedCodeReviewGraph ? [
      { id: 'crg-venv', label: 'Code Review Graph virtualenv' },
      { id: 'crg-package', label: 'Code Review Graph package' },
    ] : []),
    { id: 'crg-index', label: 'Code Review Graph index' },
    { id: 'runtime-drain', label: 'Drain previous runtime', status: 'skipped', detail: 'only when an installed runtime is active' },
    { id: 'activate-runtime', label: 'Activate runtime' },
    { id: 'runtime-restart', label: 'Restart runtime', status: 'skipped', detail: 'only when it was active before upgrade' },
    { id: 'inspect-runtime', label: 'Verify upgraded runtime' },
  ];
}

export function uninstallSteps(input: {
  repository: boolean;
  purge: boolean;
}): OperationStep[] {
  return [
    { id: 'runtime-active', label: 'Check active runtime' },
    { id: 'runtime-drain', label: 'Drain runtime' },
    { id: 'host-hooks', label: 'Restore host hooks' },
    { id: 'mcp-files', label: 'Restore MCP files' },
    ...(input.repository ? [{ id: 'git-hooks', label: 'Restore Git hooks' }] : []),
    { id: 'runtime-remove', label: 'Remove managed runtime' },
    { id: 'project-config', label: 'Remove project config' },
    ...(input.purge
      ? [{ id: 'project-data', label: 'Purge project data' }]
      : [{ id: 'project-data', label: 'Preserve project data', status: 'skipped' as const, detail: 'use --purge to remove stored data' }]),
  ];
}

function connectionDetail(connection: { transport: 'stdio'; command: string; args: string[] } | { transport: 'http'; url: string }): string {
  return connection.transport === 'http' ? connection.url : [connection.command, ...connection.args].join(' ');
}

export function formatInstallReport(input: {
  identity: ProjectIdentity;
  manifest: RuntimeLockManifest;
  inspection: RuntimeInspection;
  hosts: readonly SetupHost[];
  connection: { transport: 'stdio'; command: string; args: string[] } | { transport: 'http'; url: string };
  hooksInstalled: boolean;
  mcpConfigured: boolean;
  steps: readonly OperationStep[];
}): string {
  const versions = input.manifest.versions;
  const summaryRows = [
    ['Project', `${pc.green(cliIcons.check)} OK`, input.identity.worktreeId],
    ['Mega Brain runtime', `${pc.green(cliIcons.check)} Installed`, versions.megaBrain],
    ['AgentMemory', input.manifest.agentMemoryMode === 'managed' ? `${pc.green(cliIcons.check)} Installed` : `${pc.green(cliIcons.check)} Remote`, input.manifest.agentMemoryMode === 'managed' ? versions.agentMemory : 'remote service'],
    ['Code Review Graph', `${pc.green(cliIcons.check)} Installed`, versions.codeReviewGraph],
    ['iii-engine', versions.iiiEngine ? `${pc.green(cliIcons.check)} Installed` : pc.dim('Skipped'), versions.iiiEngine ?? 'not required'],
    ['MCP files', input.mcpConfigured ? `${pc.green(cliIcons.check)} Configured` : `${pc.red(cliIcons.cross)} Error`, input.hosts.join(', ')],
    ['Host hooks', `${pc.green(cliIcons.check)} Configured`, input.hosts.join(', ')],
    ['Git hooks', input.hooksInstalled ? `${pc.green(cliIcons.check)} Configured` : pc.dim('Skipped'), input.hooksInstalled ? 'post-commit, post-checkout, post-merge, post-rewrite' : 'Git repository unavailable'],
    ['Connection', `${pc.green(cliIcons.check)} Ready`, connectionDetail(input.connection)],
    ['Runtime checks', input.inspection.healthy ? `${pc.green(cliIcons.check)} Healthy` : `${pc.red(cliIcons.cross)} Degraded`, Object.entries(input.inspection.checks).map(([name, ok]) => `${ok ? cliIcons.check : cliIcons.cross} ${name}`).join(', ')],
  ];
  return [
    formatStepReport('Install progress', input.steps),
    '',
    pc.bold(pc.cyan('Install summary')),
    formatTerminalTable(['Component', 'Status', 'Details'], summaryRows),
  ].join('\n');
}

export function formatInstallFailureReport(input: {
  error: unknown;
  steps: readonly OperationStep[];
}): string {
  return formatStepReport('Install failed', input.steps, `${pc.red(cliIcons.cross)} ${stringifyError(input.error)}`);
}

export function formatUpgradeReport(input: {
  identity: ProjectIdentity;
  inspection: RuntimeInspection;
  steps: readonly OperationStep[];
}): string {
  const versions = input.inspection.manifest.versions;
  const backendRows = [
    ['Project', `${pc.green(cliIcons.check)} OK`, input.identity.worktreeId],
    ['Mega Brain runtime', `${pc.green(cliIcons.check)} Updated`, versions.megaBrain],
    ['AgentMemory', `${pc.green(cliIcons.check)} Updated`, input.inspection.manifest.agentMemoryMode === 'managed' ? versions.agentMemory : 'remote'],
    ['Code Review Graph', `${pc.green(cliIcons.check)} Updated`, versions.codeReviewGraph],
    ['iii-engine', versions.iiiEngine ? `${pc.green(cliIcons.check)} Updated` : pc.dim('Skipped'), versions.iiiEngine ?? 'not required'],
    ['Runtime checks', input.inspection.healthy ? `${pc.green(cliIcons.check)} Healthy` : `${pc.red(cliIcons.cross)} Degraded`, Object.entries(input.inspection.checks).map(([name, ok]) => `${ok ? cliIcons.check : cliIcons.cross} ${name}`).join(', ')],
  ];
  return [
    formatStepReport('Upgrade progress', input.steps),
    '',
    pc.bold(pc.cyan('Upgrade summary')),
    formatTerminalTable(['Component', 'Status', 'Details'], backendRows),
  ].join('\n');
}

export function formatUpgradeFailureReport(input: {
  error: unknown;
  steps: readonly OperationStep[];
}): string {
  return formatStepReport('Upgrade failed', input.steps, `${pc.red(cliIcons.cross)} ${stringifyError(input.error)}`);
}

export function formatUninstallReport(input: {
  hosts: readonly SetupHost[];
  purge: boolean;
  result: { dataPreserved: boolean };
  steps: readonly OperationStep[];
}): string {
  const summaryRows = [
    ['Hosts', `${pc.green(cliIcons.check)} Restored`, input.hosts.join(', ')],
    ['Host hooks', `${pc.green(cliIcons.check)} Removed`, 'agent hook wrappers restored from backup'],
    ['MCP files', `${pc.green(cliIcons.check)} Removed`, 'host MCP config restored from backup'],
    ['Runtime', `${pc.green(cliIcons.check)} Removed`, 'managed runtime quarantined and cleaned'],
    ['Project config', `${pc.green(cliIcons.check)} Removed`, '.mega-brain.json removed'],
    ['Project data', input.result.dataPreserved ? pc.dim('Preserved') : `${pc.green(cliIcons.check)} Purged`, input.purge ? 'removed with --purge' : 'left on disk'],
  ];
  return [
    formatStepReport('Uninstall progress', input.steps),
    '',
    pc.bold(pc.cyan('Uninstall summary')),
    formatTerminalTable(['Component', 'Status', 'Details'], summaryRows),
  ].join('\n');
}

export function formatUninstallFailureReport(input: {
  error: unknown;
  steps: readonly OperationStep[];
}): string {
  return formatStepReport('Uninstall failed', input.steps, `${pc.red(cliIcons.cross)} ${stringifyError(input.error)}`);
}

export function assertProgressTableHasReasonableWidth(value: string): boolean {
  return value.split('\n').every((line) => visibleWidth(line) < 160);
}
