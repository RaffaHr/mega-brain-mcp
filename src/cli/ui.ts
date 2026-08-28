import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import pc from 'picocolors';

let markdownRendererConfigured = false;

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
  const rows: Array<readonly [string, string]> = [
    ['Repository', String(summary.repository ?? '')],
    ['Hosts', hosts],
    ['AgentMemory', String(summary.agentMemory ?? '')],
    ...(summary.llmProvider ? [['LLM Provider', String(summary.llmProvider)] as const] : []),
    ...(summary.embeddingProvider ? [['Embedding Provider', String(summary.embeddingProvider)] as const] : []),
    ...(summary.agentMemoryFeatures ? [['AgentMemory Features', String(summary.agentMemoryFeatures)] as const] : []),
    ['Code Review Graph', String(summary.codeReviewGraphMode ?? summary.codeReviewGraph ?? '')],
    ['Data root', String(summary.dataDir ?? '')],
    ['Strict isolation', enabledLabel(Boolean(summary.strictIsolation))],
    ['Network egress', enabledLabel(Boolean(summary.allowEgress))],
    ['LLM providers', enabledLabel(Boolean(summary.allowLlm))],
  ];
  return `${pc.bold(pc.cyan('Setup summary'))}\n${formatTerminalTable(['Setting', 'Value'], rows)}`;
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
