import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import pc from 'picocolors';

let markdownRendererConfigured = false;

import { BACKEND_ENVIRONMENT_CATALOG } from '../config/backend-environment-catalog.js';
export const cliIcons = {
  ai: '✦',
  check: '✓',
  cross: '×',
  folder: '▣',
  gear: '⚙',
  git: '⌁',
  graph: '⌬',
  info: '•',
  network: '≋',
  node: '◆',
  platform: process.platform === 'win32' ? '⊞' : '◧',
  python: '◇',
  verified: '✓',
} as const;

const promptIcons: Record<string, string> = {
  repository: cliIcons.folder,
  hosts: cliIcons.ai,
  agentMemoryMode: cliIcons.graph,
  advanced: cliIcons.gear,
  dataDir: cliIcons.folder,
  crgMode: cliIcons.graph,
  allowEgress: cliIcons.network,
  allowLlm: cliIcons.ai,
  iiiEngine: cliIcons.gear,
  confirm: cliIcons.verified,
  nonGitRepositoryAction: cliIcons.git,
  remoteUrl: cliIcons.network,
  remoteAuthToken: cliIcons.verified,
  crgCommand: cliIcons.graph,
  configureMemory: cliIcons.gear,
  llmProvider: cliIcons.ai,
  anthropicApiKey: cliIcons.ai,
  openaiApiKey: cliIcons.ai,
  geminiApiKey: cliIcons.ai,
  openrouterApiKey: cliIcons.ai,
  minimaxApiKey: cliIcons.ai,
  ollamaHost: cliIcons.network,
  embeddingProvider: cliIcons.graph,
  crgEmbeddingProvider: cliIcons.graph,
  crgOpenaiApiKey: cliIcons.ai,
  crgOpenaiBaseUrl: cliIcons.network,
  crgOpenaiModel: cliIcons.graph,
  crgGoogleApiKey: cliIcons.ai,
  crgMinimaxApiKey: cliIcons.ai,
  voyageApiKey: cliIcons.ai,
  cohereApiKey: cliIcons.ai,
  graphExtraction: cliIcons.graph,
  consolidation: cliIcons.gear,
  autoCompress: cliIcons.gear,
  injectContext: cliIcons.gear,
  reflect: cliIcons.gear,
  snapshots: cliIcons.gear,
  graphWeight: cliIcons.graph,
  dropStaleIndex: cliIcons.gear,
  imageEmbeddings: cliIcons.ai,
  debugMode: cliIcons.gear,
  bridges: cliIcons.network,
  agentScope: cliIcons.folder,
  projectName: cliIcons.folder,
  advancedMemory: cliIcons.gear,
};

const spinnerFrames = ['◐', '◓', '◑', '◒'] as const;

function terminalMarkdownEnabled(output: NodeJS.WriteStream | { isTTY?: boolean }): boolean {
  return Boolean(output.isTTY);
}

function isTerminalNative(message: string): boolean {
  return /[┌┐└┘├┤┬┴┼│─]/u.test(message);
}

export function renderTerminalMarkdown(message: string, output: NodeJS.WriteStream | { isTTY?: boolean }): string {
  if (!terminalMarkdownEnabled(output) || isTerminalNative(message)) return message;
  try {
    if (!markdownRendererConfigured) {
      marked.use({ renderer: new TerminalRenderer() });
      markdownRendererConfigured = true;
    }
    return String(marked.parse(message, { async: false })).trimEnd();
  } catch {
    return message;
  }
}

export function cliLabel(message: string): string {
  if (/^\[IMPORTANT\]/u.test(message)) return pc.red(pc.bold(message));
  if (/^\[WARNING\]/u.test(message)) return pc.yellow(pc.bold(message));
  return pc.cyan(pc.bold(message));
}

export function cliMuted(message: string): string {
  return pc.dim(message);
}

export function cliPromptTheme(id: string): { prefix: string } {
  return { prefix: pc.cyan(promptIcons[id] ?? '›') };
}

export function cliSuccess(message: string): string {
  return `${pc.green(cliIcons.check)} ${message}`;
}

export function cliFailure(message: string): string {
  return `${pc.red(cliIcons.cross)} ${message}`;
}

export function cliInfo(message: string): string {
  return `${pc.cyan(cliIcons.info)} ${message}`;
}

export async function withTerminalSpinner<T>(
  output: NodeJS.WriteStream,
  message: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!output.isTTY) {
    output.write(`${cliInfo(message)}\n`);
    return run();
  }

  let frame = 0;
  output.write(`${pc.cyan(spinnerFrames[frame])} ${message}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % spinnerFrames.length;
    output.write(`\r${pc.cyan(spinnerFrames[frame])} ${message}\x1b[K`);
  }, 90);
  timer.unref();

  try {
    const result = await run();
    output.write(`\r${cliSuccess(message)}\x1b[K\n`);
    return result;
  } catch (error) {
    output.write(`\r${cliFailure(message)}\x1b[K\n`);
    throw error;
  } finally {
    clearInterval(timer);
  }
}

function visibleWidth(value: string): number {
  return Array.from(value.replace(/\x1b\[[0-9;]*m/gu, '')).length;
}

function padRight(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleWidth(value)))}`;
}

export function formatTerminalTable(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((header, column) => Math.max(
    visibleWidth(header),
    ...rows.map((row) => visibleWidth(row[column] ?? '')),
  ));
  const rule = (left: string, middle: string, right: string) => `${left}${widths.map((width) => '─'.repeat(width + 2)).join(middle)}${right}`;
  const row = (values: readonly string[]) => `│ ${values.map((value, column) => padRight(value, widths[column] ?? 0)).join(' │ ')} │`;
  return [
    rule('┌', '┬', '┐'),
    row(headers.map((header) => pc.bold(header))),
    rule('├', '┼', '┤'),
    ...rows.map(row),
    rule('└', '┴', '┘'),
  ].join('\n');
}

function enabledLabel(value: boolean): string {
  return value ? `${pc.green(cliIcons.check)} enabled` : `${pc.dim('off')}`;
}

export function formatPreflight(input: {
  nodeVersion: string;
  pythonVersion: string;
  gitVersion: string;
  platform: NodeJS.Platform;
}): string {
  return [
    pc.bold('Preflight:'),
    `${pc.green(cliIcons.node)} Node ${input.nodeVersion};`,
    `${pc.cyan(cliIcons.python)} Python ${input.pythonVersion};`,
    `${pc.magenta(cliIcons.git)} Git ${input.gitVersion};`,
    `${pc.yellow(cliIcons.platform)} ${input.platform}`,
  ].join(' ');
}


export function formatSetupSummary(summary: Record<string, unknown>): string {
  const hosts = Array.isArray(summary.hosts) ? summary.hosts.join(', ') : String(summary.hosts ?? '');
  const effective = (summary.effective ?? {}) as Record<string, unknown>;
  const agentMemory = (effective.agentMemory ?? {}) as Record<string, unknown>;
  const codeReviewGraph = (effective.codeReviewGraph ?? {}) as Record<string, unknown>;
  const sources = (summary.sources ?? {}) as Record<string, string>;
  const statuses = (summary.status ?? {}) as Record<string, string>;
  const sourceFor = (key: string, fallback = 'user') => sources[key] ?? fallback;
  const statusFor = (key: string, fallback = 'applied') => statuses[key] ?? fallback;
  const rows: Array<readonly [string, string, string, string, string]> = [
    ['Repository', String(summary.repository ?? ''), 'user', 'applied', 'Mega Brain'],
    ['Hosts', hosts, 'user', 'applied', 'Mega Brain'],
    ['dataDir', String(effective.dataDir ?? summary.dataDir ?? ''), sourceFor('dataDir', 'default'), statusFor('dataDir'), 'Mega Brain'],
    ['port', String(effective.port ?? 3000), sourceFor('port', 'default'), statusFor('port'), 'Mega Brain'],
    ['logLevel', String(effective.logLevel ?? 'info'), sourceFor('logLevel', 'default'), statusFor('logLevel'), 'Mega Brain'],
    ['allowEgress', enabledLabel(Boolean(effective.allowEgress ?? summary.allowEgress)), sourceFor('allowEgress', 'default'), statusFor('allowEgress'), 'Mega Brain'],
    ['allowLlm', enabledLabel(Boolean(effective.allowLlm ?? summary.allowLlm)), sourceFor('allowLlm', 'default'), statusFor('allowLlm'), 'Mega Brain'],
    ['agentMemory.mode', String(agentMemory.mode ?? summary.agentMemory ?? ''), sourceFor('agentMemory.mode'), statusFor('agentMemory.mode'), 'AgentMemory'],
    ['agentMemory.baseUrl', String(agentMemory.baseUrl ?? ''), sourceFor('agentMemory.baseUrl', 'inferred'), statusFor('agentMemory.baseUrl'), 'AgentMemory'],
    ['agentMemory.ports', JSON.stringify(agentMemory.ports ?? {}), sourceFor('agentMemory.ports', 'inferred'), statusFor('agentMemory.ports'), 'AgentMemory'],
    ['codeReviewGraph.command', String(codeReviewGraph.command ?? ''), sourceFor('codeReviewGraph.command', 'default'), statusFor('codeReviewGraph.command'), 'Code Review Graph'],
    ['codeReviewGraph.args', JSON.stringify(codeReviewGraph.args ?? []), sourceFor('codeReviewGraph.args', 'default'), statusFor('codeReviewGraph.args'), 'Code Review Graph'],
    ['codeReviewGraph.dataDir', String(codeReviewGraph.dataDir ?? 'unset'), sourceFor('codeReviewGraph.dataDir', 'inferred'), statusFor('codeReviewGraph.dataDir'), 'Code Review Graph'],
  ];
  if (agentMemory.authToken !== undefined) {
    rows.push(['agentMemory.authToken', String(agentMemory.authToken), sourceFor('agentMemory.authToken'), statusFor('agentMemory.authToken', 'configured'), 'AgentMemory']);
  }
  const environments: Record<string, Record<string, unknown> | undefined> = {
    agentMemory: agentMemory.environment as Record<string, unknown> | undefined,
    codeReviewGraph: codeReviewGraph.environment as Record<string, unknown> | undefined,
  };
  const groupOrder = ['Core', 'Embedding', 'LLM', 'Runtime', 'Bridges', 'Advanced'];
  for (const group of groupOrder) {
    for (const entry of BACKEND_ENVIRONMENT_CATALOG.filter((candidate) => candidate.group === group && candidate.forwarded)) {
      const consumers = new Set<string>(entry.consumers);
      for (const consumer of Object.keys(environments) as Array<keyof typeof environments>) {
        if (environments[consumer]?.[entry.key] !== undefined) consumers.add(consumer);
      }
      for (const consumer of consumers) {
        const value = environments[consumer]?.[entry.key];
        const configured = value !== undefined;
        const missingRequirements: string[] = [];
        if (entry.requires?.includes('allowEgress') && !Boolean(summary.allowEgress)) missingRequirements.push('allowEgress=true');
        if (entry.requires?.includes('allowLlm') && !Boolean(summary.allowLlm)) missingRequirements.push('allowLlm=true');
        const skipped = missingRequirements.length > 0;
        const effectiveValue = skipped
          ? 'unset'
          : configured
            ? String(value)
            : entry.defaultKind === 'value' ? String(entry.defaultValue) : 'unset';
        const sourceKey = `${consumer}.environment.${entry.key}`;
        const source = skipped ? 'default' : configured ? (sources[sourceKey] ?? 'user') : entry.defaultKind === 'value' ? 'backend default' : 'default';
        const status = skipped
          ? `skipped: requires ${missingRequirements.join(' and ')}`
          : configured ? (statuses[sourceKey] ?? 'configured') : entry.defaultKind === 'value' ? 'applied' : 'unset';
        const consumerLabel = consumer === 'agentMemory' ? 'AgentMemory' : 'Code Review Graph';
        rows.push([`${group}.${entry.key}`, effectiveValue, source, status, consumerLabel]);
      }
    }
  }
  const rendered = [`${pc.bold(pc.cyan('Setup summary'))}`, formatTerminalTable(['Setting', 'Effective value', 'Source', 'Status', 'Consumers'], rows)];
  if (Array.isArray(summary.diff)) {
    const diff = summary.diff as Array<unknown>;
    if (diff.length === 0) {
      rendered.push(pc.green('No changes'));
    } else {
      rendered.push(pc.bold(pc.cyan('Configuration changes')));
      rendered.push(formatTerminalTable(['Setting', 'Before', 'After', 'Status'], diff as Array<readonly [string, string, string, string]>));
    }
  }
  return rendered.join('\n');
}

export interface CliChecklistItem {
  status: 'success' | 'error' | 'info';
  label: string;
  detail?: string;
}

export function formatChecklist(title: string, items: readonly CliChecklistItem[], footer?: string): string {
  const rendered = items.map((item) => {
    const marker = item.status === 'success'
      ? pc.green(cliIcons.check)
      : item.status === 'error'
        ? pc.red(cliIcons.cross)
        : pc.cyan(cliIcons.info);
    return `${marker} ${item.label}${item.detail ? pc.dim(` - ${item.detail}`) : ''}`;
  });
  return [pc.bold(pc.cyan(title)), ...rendered, ...(footer ? ['', footer] : [])].join('\n');
}
