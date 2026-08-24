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

const BACKEND_ENV_PATTERNS = {
  agentMemory: /^(?:AGENTMEMORY_|EMBEDDING_|GRAPH_|CONSOLIDATION_|SNAPSHOT_)[A-Z0-9_]+$/,
  codeReviewGraph: /^(?:CRG_|CODE_REVIEW_GRAPH_|EMBEDDING_)[A-Z0-9_]+$/,
} as const;

export class UnsafeEnvironmentVariableError extends Error {
  constructor(readonly variable: string, readonly backend: keyof typeof BACKEND_ENV_PATTERNS) {
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
  backend: keyof typeof BACKEND_ENV_PATTERNS,
  values: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(values)) {
    const key = rawKey.toUpperCase();
    if (EXECUTION_CONTROL_KEYS.has(key) || !BACKEND_ENV_PATTERNS[backend].test(key)) {
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

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  filePath?: string;
  fileConfig?: Partial<MegaBrainConfigInput>;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<MegaBrainConfig> {
  const env = options.env ?? process.env;
  let fileConfig = options.fileConfig ?? {};
  if (options.filePath) {
    fileConfig = JSON.parse(await readFile(options.filePath, 'utf8')) as Partial<MegaBrainConfigInput>;
  }

  const agentEnvironment = filterBackendEnvironment(
    'agentMemory',
    parseJsonRecord(env.MEGA_BRAIN_AGENTMEMORY_ENV_JSON, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
  );
  const crgEnvironment = filterBackendEnvironment(
    'codeReviewGraph',
    parseJsonRecord(env.MEGA_BRAIN_CRG_ENV_JSON, 'MEGA_BRAIN_CRG_ENV_JSON'),
  );

  const defaults: MegaBrainConfigInput = {
    dataDir: path.join(homedir(), '.mega-brain'),
    logLevel: 'info',
    allowEgress: false,
    allowLlm: false,
    agentMemory: { baseUrl: 'http://127.0.0.1:8787', environment: {} },
    codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    projects: {},
  };

  const merged = {
    ...defaults,
    ...fileConfig,
    ...compact({
      dataDir: env.MEGA_BRAIN_DATA_DIR,
      logLevel: env.MEGA_BRAIN_LOG_LEVEL,
      allowEgress: parseBoolean(env.MEGA_BRAIN_ALLOW_EGRESS, 'MEGA_BRAIN_ALLOW_EGRESS'),
      allowLlm: parseBoolean(env.MEGA_BRAIN_ALLOW_LLM, 'MEGA_BRAIN_ALLOW_LLM'),
    }),
    agentMemory: {
      ...defaults.agentMemory,
      ...fileConfig.agentMemory,
      ...compact({
        baseUrl: env.MEGA_BRAIN_AGENTMEMORY_URL,
        authToken: env.MEGA_BRAIN_AGENTMEMORY_TOKEN,
      }),
      environment: {
        ...(fileConfig.agentMemory?.environment ?? {}),
        ...agentEnvironment,
      },
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
