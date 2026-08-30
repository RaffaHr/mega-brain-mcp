import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG, megaBrainConfigSchema, type MegaBrainConfig, type MegaBrainConfigInput } from './schema.js';
import {
  DEFAULT_MANAGED_DEPENDENCY_VERSIONS,
  LEGACY_III_ENGINE_VERSION_ENV,
  MANAGED_DEPENDENCY_VERSION_ENV,
  parseManagedDependencyVersion,
  type ManagedDependencyVersions,
} from '../runtime/dependency-versions.js';
import { redactValue } from '../security/redaction.js';

const PROJECT_CONFIG_DOTENV_KEYS = new Set([
  ...Object.values(MANAGED_DEPENDENCY_VERSION_ENV),
  LEGACY_III_ENGINE_VERSION_ENV,
]);

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
  'AGENT_ID',
  'AGENTMEMORY_CHEAP_MODEL',
  'AGENTMEMORY_CLAUDE_CODE_BRIDGE',
  'AGENTMEMORY_CLINE_BRIDGE',
  'AGENTMEMORY_CURSOR_BRIDGE',
  'AGENTMEMORY_MODEL',
  'AGENTMEMORY_WINDSURF_BRIDGE',
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
  'AGENTMEMORY_IMAGE_EMBEDDINGS',
  'AGENTMEMORY_IMAGE_STORE_MAX_BYTES',
  'AGENTMEMORY_INJECT_CONTEXT',
  'AGENTMEMORY_LLM_NOTHINK',
  'AGENTMEMORY_LLM_TIMEOUT_MS',
  'AGENTMEMORY_METRICS_PORT',
  'AGENTMEMORY_PROBE_TIMEOUT_MS',
  'AGENTMEMORY_PROJECT_NAME',
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
  'EMBEDDING_MODEL',
  'EMBEDDING_PROVIDER',
  'GEMINI_API_KEY',
  'GRAPH_EXTRACTION_ENABLED',
  'MINIMAX_API_KEY',
  'OLLAMA_HOST',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SNAPSHOT_ENABLED',
  'VOYAGE_API_KEY',
]);

const BACKEND_ENV_PATTERNS = {
  codeReviewGraph: /^(?:CRG_|CODE_REVIEW_GRAPH_|EMBEDDING_)[A-Z0-9_]+$/,
} as const;

type BackendName = 'agentMemory' | 'codeReviewGraph';

export type ConfigSource = 'flag' | 'process' | 'dotenv' | 'config' | 'default';

export interface ConfigFlags {
  dataDir?: string;
  port?: number;
  logLevel?: string;
  allowEgress?: boolean;
  allowLlm?: boolean;
  agentMemoryMode?: string;
  agentMemoryBaseUrl?: string;
  agentMemoryAuthToken?: string;
  codeReviewGraphCommand?: string;
  codeReviewGraphDataDir?: string;
}

export interface LoadedConfigWithSources {
  config: MegaBrainConfig;
  sources: Record<string, ConfigSource>;
}

export interface LoadedManagedDependencyVersions {
  versions: ManagedDependencyVersions;
  sources: Record<keyof ManagedDependencyVersions, ConfigSource>;
}

export class UnsafeEnvironmentVariableError extends Error {
  constructor(readonly variable: string, readonly backend: BackendName) {
    super(`Environment variable ${variable} is not allowed for ${backend}`);
    this.name = 'UnsafeEnvironmentVariableError';
  }
}

function persistedConfigEffective(value: unknown): Partial<MegaBrainConfigInput> {
  if (value && typeof value === 'object' && Array.isArray(value) === false) {
    const record = value as Record<string, unknown>;
    if (record.effective && typeof record.effective === 'object' && Array.isArray(record.effective) === false) {
      return record.effective as Partial<MegaBrainConfigInput>;
    }
  }
  return value as Partial<MegaBrainConfigInput>;
}

function projectDotEnvValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => PROJECT_CONFIG_DOTENV_KEYS.has(key)));
}

function parseJsonRecord(raw: string | undefined, variable: string): Record<string, string> {
  if (raw === undefined || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${variable} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variable} must contain a JSON object`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${variable}.${key} must be a string`);
    }
    result[key] = value;
  }
  return result;
}

function parseJsonArray(raw: string | undefined, variable: string): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${variable} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
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

function parsePort(raw: string | number | undefined, variable: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${variable} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function firstDefined<T>(
  candidates: ReadonlyArray<readonly [T | undefined, ConfigSource]>,
): { value: T; source: ConfigSource } {
  for (const [value, source] of candidates) {
    if (value !== undefined) return { value, source };
  }
  throw new Error('Configuration value has no default');
}

function resolveAgainstRepo(repoPath: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repoPath, value);
}

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match?.[1]) continue;
    const [, key, rawValue = ''] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function loadDotEnv(filePath: string): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await readFile(filePath, 'utf8'));
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

function directCrgEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.toUpperCase();
    const value = nonEmpty(rawValue);
    if (value === undefined) continue;
    if (BACKEND_ENV_PATTERNS.codeReviewGraph.test(key)) {
      if (!EXECUTION_CONTROL_KEYS.has(key)) {
        result[key] = value;
      }
    }
  }
  return result;
}

const LLM_CREDENTIALS = new Set([
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MINIMAX_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
]);
const REMOTE_EMBEDDING_CREDENTIALS = new Set([
  'COHERE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'VOYAGE_API_KEY',
]);
const LLM_FEATURE_FLAGS = new Set([
  'AGENTMEMORY_AUTO_COMPRESS',
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
  const localLlmConfigured = Boolean(environment.OLLAMA_HOST);
  for (const key of LLM_FEATURE_FLAGS) {
    if (!enabled(environment[key])) continue;
    if (!options.allowLlm) throw new Error(`${key} requires MEGA_BRAIN_ALLOW_LLM=true`);
    if (!localLlmConfigured && !options.allowEgress) {
      throw new Error(`${key} requires MEGA_BRAIN_ALLOW_EGRESS=true unless OLLAMA_HOST configures a local LLM`);
    }
  }
  const embeddingProvider = environment.EMBEDDING_PROVIDER?.toLowerCase();
  if (embeddingProvider && embeddingProvider !== 'local' && !options.allowEgress) {
    throw new Error('EMBEDDING_PROVIDER requires MEGA_BRAIN_ALLOW_EGRESS=true unless set to local');
  }
  const agentScope = environment.AGENTMEMORY_AGENT_SCOPE?.toLowerCase();
  if (agentScope === 'isolated' && !environment.AGENT_ID?.trim()) {
    throw new Error('AGENT_ID is required when AGENTMEMORY_AGENT_SCOPE=isolated');
  }
}

const CRG_REMOTE_KEYS = [
  'CRG_OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'MINIMAX_API_KEY',
];

function resolveAndValidateCrgEnvironment(
  rawEnvironment: Record<string, string>,
  options: { allowEgress: boolean; allowLlm: boolean },
  fallbackEnv: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = { ...rawEnvironment };

  if (!env.CRG_OPENAI_API_KEY && fallbackEnv.CRG_OPENAI_API_KEY) {
    env.CRG_OPENAI_API_KEY = fallbackEnv.CRG_OPENAI_API_KEY;
  } else if (!env.CRG_OPENAI_API_KEY && fallbackEnv.OPENAI_API_KEY && options.allowEgress) {
    env.CRG_OPENAI_API_KEY = fallbackEnv.OPENAI_API_KEY;
  }

  if (!env.GOOGLE_API_KEY && (fallbackEnv.GOOGLE_API_KEY || fallbackEnv.GEMINI_API_KEY) && options.allowEgress) {
    env.GOOGLE_API_KEY = (fallbackEnv.GOOGLE_API_KEY || fallbackEnv.GEMINI_API_KEY)!;
  }

  if (!env.MINIMAX_API_KEY && fallbackEnv.MINIMAX_API_KEY && options.allowEgress) {
    env.MINIMAX_API_KEY = fallbackEnv.MINIMAX_API_KEY;
  }

  for (const key of CRG_REMOTE_KEYS) {
    if (env[key] && !options.allowEgress) {
      throw new Error(`${key} requires MEGA_BRAIN_ALLOW_EGRESS=true`);
    }
  }

  const hasCloudKey = Boolean(
    env.CRG_OPENAI_API_KEY
    || env.GOOGLE_API_KEY
    || env.MINIMAX_API_KEY
    || (env.CRG_OPENAI_BASE_URL && !/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|::1)/iu.test(env.CRG_OPENAI_BASE_URL))
  );

  if (hasCloudKey && options.allowEgress && !env.CRG_ACCEPT_CLOUD_EMBEDDINGS) {
    env.CRG_ACCEPT_CLOUD_EMBEDDINGS = '1';
  }

  return env;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  repoPath?: string;
  envFilePath?: string | false;
  filePath?: string | false;
  fileConfig?: Partial<MegaBrainConfigInput>;
  flags?: ConfigFlags;
}

export async function loadConfigWithSources(options: LoadConfigOptions = {}): Promise<LoadedConfigWithSources> {
  const flags = options.flags ?? {};
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  const processEnvironment = options.env ?? process.env;
  let fileConfig: Partial<MegaBrainConfigInput> = options.fileConfig ?? {};
  if (!options.fileConfig && options.filePath !== false) {
    const configPath = resolveAgainstRepo(repoPath, options.filePath ?? path.join('.mega-brain', 'config.json'));
    try {
      fileConfig = persistedConfigEffective(JSON.parse(await readFile(configPath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const env = { ...processEnvironment };

  const sourceEnv = (key: string): { value: string | undefined; source: ConfigSource | undefined } => {
    const processValue = nonEmpty(processEnvironment[key]);
    if (processValue !== undefined) return { value: processValue, source: 'process' };
    return { value: undefined, source: undefined };
  };

  const processCrgEnvironment = filterBackendEnvironment('codeReviewGraph', parseJsonRecord(
    processEnvironment.MEGA_BRAIN_CRG_ENV_JSON,
    'MEGA_BRAIN_CRG_ENV_JSON',
  ));
  const dotEnvCrgEnvironment: Record<string, string> = {};

  const defaults: MegaBrainConfigInput = {
    dataDir: path.join(homedir(), '.mega-brain'),
    ...DEFAULT_CONFIG,
  };

  const dataDirEnv = sourceEnv('MEGA_BRAIN_DATA_DIR');
  const dataDir = firstDefined<string>([
    [nonEmpty(flags.dataDir), 'flag'],
    [dataDirEnv.value, dataDirEnv.source ?? 'process'],
    [nonEmpty(fileConfig.dataDir), 'config'],
    [defaults.dataDir, 'default'],
  ]);
  const portEnv = sourceEnv('MEGA_BRAIN_PORT');
  const port = firstDefined<number>([
    [parsePort(flags.port, '--port'), 'flag'],
    [parsePort(portEnv.value, 'MEGA_BRAIN_PORT'), portEnv.source ?? 'process'],
    [fileConfig.port, 'config'],
    [defaults.port, 'default'],
  ]);
  const logLevelEnv = sourceEnv('MEGA_BRAIN_LOG_LEVEL');
  const logLevel = firstDefined<string>([
    [nonEmpty(flags.logLevel), 'flag'],
    [logLevelEnv.value, logLevelEnv.source ?? 'process'],
    [fileConfig.logLevel, 'config'],
    [defaults.logLevel, 'default'],
  ]);
  const allowEgressEnv = sourceEnv('MEGA_BRAIN_ALLOW_EGRESS');
  const allowEgressResolved = firstDefined<boolean>([
    [flags.allowEgress, 'flag'],
    [parseBoolean(allowEgressEnv.value, 'MEGA_BRAIN_ALLOW_EGRESS'), allowEgressEnv.source ?? 'process'],
    [fileConfig.allowEgress, 'config'],
    [defaults.allowEgress, 'default'],
  ]);
  const allowLlmEnv = sourceEnv('MEGA_BRAIN_ALLOW_LLM');
  const allowLlmResolved = firstDefined<boolean>([
    [flags.allowLlm, 'flag'],
    [parseBoolean(allowLlmEnv.value, 'MEGA_BRAIN_ALLOW_LLM'), allowLlmEnv.source ?? 'process'],
    [fileConfig.allowLlm, 'config'],
    [defaults.allowLlm, 'default'],
  ]);
  const allowEgress = Boolean(allowEgressResolved.value);
  const allowLlm = Boolean(allowLlmResolved.value);

  const agentMemoryModeEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_MODE');
  const agentMemoryMode = firstDefined<MegaBrainConfig['agentMemory']['mode']>([
    [flags.agentMemoryMode as MegaBrainConfig['agentMemory']['mode'], 'flag'],
    [agentMemoryModeEnv.value as MegaBrainConfig['agentMemory']['mode'], agentMemoryModeEnv.source ?? 'process'],
    [fileConfig.agentMemory?.mode, 'config'],
    [defaults.agentMemory?.mode, 'default'],
  ]);

  const agentMemoryBaseUrlEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_URL');
  const agentMemoryBaseUrl = firstDefined<string>([
    [nonEmpty(flags.agentMemoryBaseUrl), 'flag'],
    [agentMemoryBaseUrlEnv.value, agentMemoryBaseUrlEnv.source ?? 'process'],
    [fileConfig.agentMemory?.baseUrl, 'config'],
    [defaults.agentMemory?.baseUrl, 'default'],
  ]);
  let agentEnvironment: Record<string, string> = {};
  if (agentMemoryMode.value === 'managed') {
    agentEnvironment = {
      ...filterBackendEnvironment('agentMemory', fileConfig.agentMemory?.environment ?? {}),
      ...filterBackendEnvironment(
        'agentMemory',
        parseJsonRecord(undefined, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
      ),
      ...directAgentMemoryEnvironment({}),
      ...filterBackendEnvironment(
        'agentMemory',
        parseJsonRecord(processEnvironment.MEGA_BRAIN_AGENTMEMORY_ENV_JSON, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
      ),
      ...directAgentMemoryEnvironment(processEnvironment),
    };
    validateAgentMemoryOptIns(agentEnvironment, { allowEgress, allowLlm });
  }

  const agentMemoryTokenEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_TOKEN');
  const managedAgentMemorySecretEnv = sourceEnv('AGENTMEMORY_SECRET');
  const managedAgentMemorySecret = agentMemoryMode.value === 'managed'
    ? managedAgentMemorySecretEnv.value
    : undefined;
  const agentMemoryToken = nonEmpty(flags.agentMemoryAuthToken)
    ?? agentMemoryTokenEnv.value
    ?? nonEmpty(fileConfig.agentMemory?.authToken)
    ?? managedAgentMemorySecret;
  const agentMemoryTokenSource: ConfigSource = flags.agentMemoryAuthToken
    ? 'flag'
    : agentMemoryTokenEnv.source
      ?? (fileConfig.agentMemory?.authToken ? 'config' : undefined)
      ?? (managedAgentMemorySecret ? managedAgentMemorySecretEnv.source : undefined)
      ?? 'default';

  const restPortEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_REST_PORT');
  const streamsPortEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_STREAMS_PORT');
  const viewerPortEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_VIEWER_PORT');
  const enginePortEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_ENGINE_PORT');
  const defaultPorts = defaults.agentMemory?.ports ?? { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 };
  const agentMemoryPorts = {
    rest: firstDefined<number>([
      [parsePort(restPortEnv.value, 'MEGA_BRAIN_AGENTMEMORY_REST_PORT'), restPortEnv.source ?? 'process'],
      [fileConfig.agentMemory?.ports?.rest, 'config'], [defaultPorts.rest, 'default'],
    ]),
    streams: firstDefined<number>([
      [parsePort(streamsPortEnv.value, 'MEGA_BRAIN_AGENTMEMORY_STREAMS_PORT'), streamsPortEnv.source ?? 'process'],
      [fileConfig.agentMemory?.ports?.streams, 'config'], [defaultPorts.streams, 'default'],
    ]),
    viewer: firstDefined<number>([
      [parsePort(viewerPortEnv.value, 'MEGA_BRAIN_AGENTMEMORY_VIEWER_PORT'), viewerPortEnv.source ?? 'process'],
      [fileConfig.agentMemory?.ports?.viewer, 'config'], [defaultPorts.viewer, 'default'],
    ]),
    engine: firstDefined<number>([
      [parsePort(enginePortEnv.value, 'MEGA_BRAIN_AGENTMEMORY_ENGINE_PORT'), enginePortEnv.source ?? 'process'],
      [fileConfig.agentMemory?.ports?.engine, 'config'], [defaultPorts.engine, 'default'],
    ]),
  };

  const crgCommandEnv = sourceEnv('MEGA_BRAIN_CRG_COMMAND');
  const crgCommand = firstDefined<string>([
    [nonEmpty(flags.codeReviewGraphCommand), 'flag'],
    [crgCommandEnv.value, crgCommandEnv.source ?? 'process'],
    [fileConfig.codeReviewGraph?.command, 'config'],
    [defaults.codeReviewGraph?.command, 'default'],
  ]);
  const crgDataDirEnv = sourceEnv('MEGA_BRAIN_CRG_DATA_DIR');
  const crgDataDir = firstDefined<string | null>([
    [nonEmpty(flags.codeReviewGraphDataDir), 'flag'],
    [crgDataDirEnv.value, crgDataDirEnv.source ?? 'process'],
    [fileConfig.codeReviewGraph?.dataDir, 'config'],
    [null, 'default'],
  ]);

  const rawCrgEnvironment = {
    ...filterBackendEnvironment('codeReviewGraph', fileConfig.codeReviewGraph?.environment ?? {}),
    ...dotEnvCrgEnvironment,
    ...directCrgEnvironment({}),
    ...processCrgEnvironment,
    ...directCrgEnvironment(processEnvironment),
  };

  const effectiveCrgEnvironment = resolveAndValidateCrgEnvironment(
    rawCrgEnvironment,
    { allowEgress, allowLlm },
    env,
  );

  const merged = {
    ...defaults,
    ...fileConfig,
    dataDir: resolveAgainstRepo(repoPath, dataDir.value),
    port: port.value,
    logLevel: logLevel.value,
    allowEgress,
    allowLlm,
    agentMemory: {
      mode: agentMemoryMode.value,
      baseUrl: agentMemoryBaseUrl.value,
      ...compact({ authToken: agentMemoryToken }),
      ports: Object.fromEntries(Object.entries(agentMemoryPorts).map(([key, entry]) => [key, entry.value])),
      environment: agentEnvironment,
    },
    codeReviewGraph: {
      ...defaults.codeReviewGraph,
      ...fileConfig.codeReviewGraph,
      ...compact({
        command: crgCommand.value,
        args: parseJsonArray(env.MEGA_BRAIN_CRG_ARGS_JSON, 'MEGA_BRAIN_CRG_ARGS_JSON'),
        dataDir: crgDataDir.value === null ? undefined : resolveAgainstRepo(repoPath, crgDataDir.value),
      }),
      environment: effectiveCrgEnvironment,
    },
  };

  const config = megaBrainConfigSchema.parse(merged);
  const sources: Record<string, ConfigSource> = {
    dataDir: dataDir.source,
    port: port.source,
    logLevel: logLevel.source,
    allowEgress: allowEgressResolved.source,
    allowLlm: allowLlmResolved.source,
    'agentMemory.mode': agentMemoryMode.source,
    'agentMemory.baseUrl': agentMemoryBaseUrl.source,
    'agentMemory.authToken': agentMemoryTokenSource,
    'agentMemory.ports.rest': agentMemoryPorts.rest.source,
    'agentMemory.ports.streams': agentMemoryPorts.streams.source,
    'agentMemory.ports.viewer': agentMemoryPorts.viewer.source,
    'agentMemory.ports.engine': agentMemoryPorts.engine.source,
    'codeReviewGraph.command': crgCommand.source,
    'codeReviewGraph.dataDir': crgDataDir.source,
  };
  return { config, sources };
}

export async function loadManagedDependencyVersions(
  options: Pick<LoadConfigOptions, 'env' | 'repoPath' | 'envFilePath'> = {},
): Promise<LoadedManagedDependencyVersions> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  const envFilePath = options.envFilePath === false
    ? undefined
    : resolveAgainstRepo(repoPath, options.envFilePath ?? '.env');
  const envFromFile = envFilePath ? await loadDotEnv(envFilePath) : {};
  const projectDotEnv = projectDotEnvValues(envFromFile);
  const processEnvironment = options.env ?? process.env;
  const sourceEnv = (key: string): { value: string | undefined; source: ConfigSource | undefined } => {
    const processValue = nonEmpty(processEnvironment[key]);
    if (processValue !== undefined) return { value: processValue, source: 'process' };
    const dotEnvValue = nonEmpty(projectDotEnv[key]);
    if (dotEnvValue !== undefined) return { value: dotEnvValue, source: 'dotenv' };
    return { value: undefined, source: undefined };
  };
  const resolveVersion = (
    key: keyof ManagedDependencyVersions,
    environmentKey: string,
    fallbackEnvironmentKey?: string,
  ): { value: string; source: ConfigSource } => {
    const primary = sourceEnv(environmentKey);
    const fallback = fallbackEnvironmentKey ? sourceEnv(fallbackEnvironmentKey) : { value: undefined, source: undefined };
    const resolved = firstDefined<string>([
      [primary.value ? parseManagedDependencyVersion(primary.value, environmentKey) : undefined, primary.source ?? 'process'],
      [fallback.value ? parseManagedDependencyVersion(fallback.value, fallbackEnvironmentKey!) : undefined, fallback.source ?? 'process'],
      [DEFAULT_MANAGED_DEPENDENCY_VERSIONS[key], 'default'],
    ]);
    return { value: resolved.value, source: resolved.source };
  };
  const agentMemory = resolveVersion('agentMemory', MANAGED_DEPENDENCY_VERSION_ENV.agentMemory);
  const codeReviewGraph = resolveVersion('codeReviewGraph', MANAGED_DEPENDENCY_VERSION_ENV.codeReviewGraph);
  const iiiEngine = resolveVersion('iiiEngine', MANAGED_DEPENDENCY_VERSION_ENV.iiiEngine, LEGACY_III_ENGINE_VERSION_ENV);
  return {
    versions: {
      agentMemory: agentMemory.value,
      codeReviewGraph: codeReviewGraph.value,
      iiiEngine: iiiEngine.value,
    },
    sources: {
      agentMemory: agentMemory.source,
      codeReviewGraph: codeReviewGraph.source,
      iiiEngine: iiiEngine.source,
    },
  };
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<MegaBrainConfig> {
  return (await loadConfigWithSources(options)).config;
}
export function redactConfig(config: MegaBrainConfig): Record<string, unknown> {
  return redactValue(config) as Record<string, unknown>;
}
