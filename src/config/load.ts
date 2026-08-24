import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { megaBrainConfigSchema, type MegaBrainConfig, type MegaBrainConfigInput } from './schema.js';
import { redactValue } from '../security/redaction.js';

const EXECUTION_CONTROL_KEYS = new Set([
  'BASH_ENV',
  'COMSPEC',
  'DYLD_INSERT_LIBRARIES',
  'ENV',
  'HOME',
  'IFS',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'PATH',
  'PATHEXT',
  'PROMPT_COMMAND',
  'PSMODULEPATH',
  'PYTHONHOME',
  'PYTHONPATH',
  'SHELL',
  'USERPROFILE',
]);

export const AGENTMEMORY_ENV_ALLOWLIST = new Set([
  'AGENTMEMORY_AGENT_SCOPE',
  'AGENTMEMORY_ALLOW_AGENT_SDK',
  'AGENTMEMORY_AUTO_COMPRESS',
  'AGENTMEMORY_CONSOLIDATION_COOLDOWN_MS',
  'AGENTMEMORY_DATA_DIR',
  'AGENTMEMORY_DEBUG',
  'AGENTMEMORY_DOCKER_GID',
  'AGENTMEMORY_DOCKER_SKIP_CHOWN',
  'AGENTMEMORY_DOCKER_UID',
  'AGENTMEMORY_DROP_STALE_INDEX',
  'AGENTMEMORY_EXPORT_ROOT',
  'AGENTMEMORY_FOLLOWUP_WINDOW_SECONDS',
  'AGENTMEMORY_FORCE_PROXY',
  'AGENTMEMORY_GRAPH_WEIGHT',
  'AGENTMEMORY_III_CONFIG',
  'AGENTMEMORY_III_VERSION',
  'AGENTMEMORY_IMAGE_EMBEDDINGS',
  'AGENTMEMORY_IMAGE_STORE_MAX_BYTES',
  'AGENTMEMORY_INJECT_CONTEXT',
  'AGENTMEMORY_LLM_NOTHINK',
  'AGENTMEMORY_LLM_TIMEOUT_MS',
  'AGENTMEMORY_METRICS_PORT',
  'AGENTMEMORY_PROBE_TIMEOUT_MS',
  'AGENTMEMORY_PROJECT_NAME',
  'AGENTMEMORY_PROVIDER',
  'AGENTMEMORY_REFLECT',
  'AGENTMEMORY_SECRET',
  'AGENTMEMORY_SLOTS',
  'AGENTMEMORY_SUPPRESS_COST_WARNING',
  'AGENTMEMORY_TOOLS',
  'AGENTMEMORY_USE_DOCKER',
  'AGENTMEMORY_VERBOSE',
  'AGENTMEMORY_VIEWER_HOST',
  'AGENTMEMORY_VIEWER_URL',
  'ANTHROPIC_API_KEY',
  'COHERE_API_KEY',
  'CONSOLIDATION_ENABLED',
  'EMBEDDING_PROVIDER',
  'GRAPH_EXTRACTION_ENABLED',
  'OPENAI_API_KEY',
  'SNAPSHOT_ENABLED',
  'VOYAGE_API_KEY',
]);

const BACKEND_ENV_PATTERNS = {
  codeReviewGraph: /^(?:CRG_|CODE_REVIEW_GRAPH_|EMBEDDING_)[A-Z0-9_]+$/,
} as const;

type BackendName = 'agentMemory' | 'codeReviewGraph';

export class UnsafeEnvironmentVariableError extends Error {
  constructor(readonly variable: string, readonly backend: BackendName) {
    super(`Environment variable ${variable} is not allowed for ${backend}`);
    this.name = 'UnsafeEnvironmentVariableError';
  }
}

function parseJsonRecord(raw: string | undefined, variable: string): Record<string, string> {
  if (raw === undefined || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${variable} must contain a JSON object of string values`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${variable} must contain a JSON object of string values`);
  }

  const entries = Object.entries(parsed);
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error(`${variable} must contain a JSON object of string values`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseJsonArray(raw: string | undefined, variable: string): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${variable} must contain a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error(`${variable} must contain a JSON array of strings`);
  }
  return parsed;
}

export function filterBackendEnvironment(
  backend: BackendName,
  values: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(values)) {
    const key = rawKey.toUpperCase();
    const allowed = backend === 'agentMemory'
      ? AGENTMEMORY_ENV_ALLOWLIST.has(key)
      : BACKEND_ENV_PATTERNS.codeReviewGraph.test(key);
    if (EXECUTION_CONTROL_KEYS.has(key) || !allowed) {
      throw new UnsafeEnvironmentVariableError(key, backend);
    }
    result[key] = value;
  }
  return result;
}

function parseBoolean(raw: string | undefined, variable: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (/^(?:1|true|yes|on)$/i.test(raw)) return true;
  if (/^(?:0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${variable} must be a boolean`);
}

function nonEmpty(raw: string | undefined): string | undefined {
  return raw?.trim() ? raw : undefined;
}

function parseDotEnv(raw: string, filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match) throw new Error(`${filePath}:${index + 1} must use KEY=value syntax without export`);
    const key = match[1];
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

async function loadDotEnv(filePath: string): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await readFile(filePath, 'utf8'), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function directAgentMemoryEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries([...AGENTMEMORY_ENV_ALLOWLIST]
    .map((key) => [key, nonEmpty(env[key])] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

const LLM_CREDENTIALS = new Set(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
const REMOTE_EMBEDDING_CREDENTIALS = new Set(['COHERE_API_KEY', 'VOYAGE_API_KEY']);
const LLM_FEATURE_FLAGS = new Set([
  'AGENTMEMORY_AUTO_COMPRESS',
  'AGENTMEMORY_INJECT_CONTEXT',
  'AGENTMEMORY_REFLECT',
  'CONSOLIDATION_ENABLED',
  'GRAPH_EXTRACTION_ENABLED',
]);

function enabled(raw: string | undefined): boolean {
  return raw !== undefined && /^(?:1|true|yes|on)$/iu.test(raw);
}

function validateAgentMemoryOptIns(
  environment: Record<string, string>,
  options: { allowEgress: boolean; allowLlm: boolean },
): void {
  for (const key of LLM_CREDENTIALS) {
    if (environment[key] && (!options.allowEgress || !options.allowLlm)) {
      throw new Error(`${key} requires MEGA_BRAIN_ALLOW_EGRESS=true and MEGA_BRAIN_ALLOW_LLM=true`);
    }
  }
  for (const key of REMOTE_EMBEDDING_CREDENTIALS) {
    if (environment[key] && !options.allowEgress) {
      throw new Error(`${key} requires MEGA_BRAIN_ALLOW_EGRESS=true`);
    }
  }
  for (const key of LLM_FEATURE_FLAGS) {
    if (enabled(environment[key]) && (!options.allowEgress || !options.allowLlm)) {
      throw new Error(`${key} requires MEGA_BRAIN_ALLOW_EGRESS=true and MEGA_BRAIN_ALLOW_LLM=true`);
    }
  }
  const embeddingProvider = environment.EMBEDDING_PROVIDER?.toLowerCase();
  if (embeddingProvider && embeddingProvider !== 'local' && !options.allowEgress) {
    throw new Error('EMBEDDING_PROVIDER requires MEGA_BRAIN_ALLOW_EGRESS=true unless set to local');
  }
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  repoPath?: string;
  envFilePath?: string | false;
  filePath?: string;
  fileConfig?: Partial<MegaBrainConfigInput>;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<MegaBrainConfig> {
  const envFilePath = options.envFilePath === false
    ? undefined
    : options.envFilePath ?? path.join(options.repoPath ?? process.cwd(), '.env');
  const envFromFile = envFilePath ? await loadDotEnv(envFilePath) : {};
  const env: NodeJS.ProcessEnv = { ...envFromFile, ...(options.env ?? process.env) };
  let fileConfig = options.fileConfig ?? {};
  if (options.filePath) {
    fileConfig = JSON.parse(await readFile(options.filePath, 'utf8')) as Partial<MegaBrainConfigInput>;
  }

  const crgEnvironment = filterBackendEnvironment(
    'codeReviewGraph',
    parseJsonRecord(env.MEGA_BRAIN_CRG_ENV_JSON, 'MEGA_BRAIN_CRG_ENV_JSON'),
  );

  const defaults: MegaBrainConfigInput = {
    dataDir: path.join(homedir(), '.mega-brain'),
    logLevel: 'info',
    allowEgress: false,
    allowLlm: false,
    agentMemory: { mode: 'managed', baseUrl: 'http://127.0.0.1:3111', environment: {} },
    codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    projects: {},
  };

  const allowEgress = parseBoolean(env.MEGA_BRAIN_ALLOW_EGRESS, 'MEGA_BRAIN_ALLOW_EGRESS')
    ?? fileConfig.allowEgress
    ?? defaults.allowEgress
    ?? false;
  const allowLlm = parseBoolean(env.MEGA_BRAIN_ALLOW_LLM, 'MEGA_BRAIN_ALLOW_LLM')
    ?? fileConfig.allowLlm
    ?? defaults.allowLlm
    ?? false;
  const agentMemoryMode = env.MEGA_BRAIN_AGENTMEMORY_MODE
    ?? fileConfig.agentMemory?.mode
    ?? defaults.agentMemory.mode;

  let agentEnvironment: Record<string, string> = {};
  if (agentMemoryMode === 'managed') {
    agentEnvironment = {
      ...filterBackendEnvironment('agentMemory', fileConfig.agentMemory?.environment ?? {}),
      ...filterBackendEnvironment(
        'agentMemory',
        parseJsonRecord(env.MEGA_BRAIN_AGENTMEMORY_ENV_JSON, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
      ),
      ...directAgentMemoryEnvironment(env),
    };
    validateAgentMemoryOptIns(agentEnvironment, { allowEgress, allowLlm });
  }

  const explicitAgentMemoryToken = nonEmpty(env.MEGA_BRAIN_AGENTMEMORY_TOKEN)
    ?? nonEmpty(fileConfig.agentMemory?.authToken);
  const agentMemoryToken = explicitAgentMemoryToken
    ?? (agentMemoryMode === 'managed' ? nonEmpty(agentEnvironment.AGENTMEMORY_SECRET) : undefined);

  const merged = {
    ...defaults,
    ...fileConfig,
    ...compact({
      dataDir: env.MEGA_BRAIN_DATA_DIR,
      logLevel: env.MEGA_BRAIN_LOG_LEVEL,
      allowEgress,
      allowLlm,
    }),
    agentMemory: {
      mode: agentMemoryMode,
      baseUrl: nonEmpty(env.MEGA_BRAIN_AGENTMEMORY_URL)
        ?? fileConfig.agentMemory?.baseUrl
        ?? defaults.agentMemory.baseUrl,
      ...compact({ authToken: agentMemoryToken }),
      environment: agentEnvironment,
    },
    codeReviewGraph: {
      ...defaults.codeReviewGraph,
      ...fileConfig.codeReviewGraph,
      ...compact({
        command: env.MEGA_BRAIN_CRG_COMMAND,
        args: parseJsonArray(env.MEGA_BRAIN_CRG_ARGS_JSON, 'MEGA_BRAIN_CRG_ARGS_JSON'),
        dataDir: env.MEGA_BRAIN_CRG_DATA_DIR,
      }),
      environment: {
        ...(fileConfig.codeReviewGraph?.environment ?? {}),
        ...crgEnvironment,
      },
    },
  };

  return megaBrainConfigSchema.parse(merged);
}

export function redactConfig(config: MegaBrainConfig): Record<string, unknown> {
  return redactValue(config) as Record<string, unknown>;
}
