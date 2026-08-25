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

export type ConfigSource = 'flag' | 'process' | 'dotenv' | 'config' | 'default';

export interface ConfigFlags {
  dataDir?: string;
  port?: number;
  logLevel?: string;
  allowEgress?: boolean;
  allowLlm?: boolean;
  agentMemoryMode?: string;
  agentMemoryBaseUrl?: string;
  agentMemorySecretEnvVar?: string;
  codeReviewGraphCommand?: string;
  codeReviewGraphDataDir?: string;
}

export interface LoadedConfigWithSources {
  config: MegaBrainConfig;
  sources: Record<string, ConfigSource>;
}

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
  flags?: ConfigFlags;
}

export async function loadConfigWithSources(options: LoadConfigOptions = {}): Promise<LoadedConfigWithSources> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  const envFilePath = options.envFilePath === false
    ? undefined
    : resolveAgainstRepo(repoPath, options.envFilePath ?? '.env');
  const envFromFile = envFilePath ? await loadDotEnv(envFilePath) : {};
  const processEnvironment = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = { ...envFromFile, ...processEnvironment };
  let fileConfig = options.fileConfig ?? {};
  if (options.filePath) {
    const filePath = resolveAgainstRepo(repoPath, options.filePath);
    fileConfig = JSON.parse(await readFile(filePath, 'utf8')) as Partial<MegaBrainConfigInput>;
  }

  const flags = options.flags ?? {};
  const sourceEnv = (key: string): { value: string | undefined; source: ConfigSource | undefined } => {
    const processValue = nonEmpty(processEnvironment[key]);
    if (processValue !== undefined) return { value: processValue, source: 'process' };
    const dotEnvValue = nonEmpty(envFromFile[key]);
    if (dotEnvValue !== undefined) return { value: dotEnvValue, source: 'dotenv' };
    return { value: undefined, source: undefined };
  };

  const processCrgEnvironment = filterBackendEnvironment('codeReviewGraph', parseJsonRecord(
    processEnvironment.MEGA_BRAIN_CRG_ENV_JSON,
    'MEGA_BRAIN_CRG_ENV_JSON',
  ));
  const dotEnvCrgEnvironment = filterBackendEnvironment('codeReviewGraph', parseJsonRecord(
    envFromFile.MEGA_BRAIN_CRG_ENV_JSON,
    'MEGA_BRAIN_CRG_ENV_JSON',
  ));

  const defaults: MegaBrainConfigInput = {
    dataDir: path.join(homedir(), '.mega-brain'),
    port: 3000,
    logLevel: 'info',
    allowEgress: false,
    allowLlm: false,
    agentMemory: {
      mode: 'managed',
      baseUrl: 'http://127.0.0.1:3111',
      ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
      environment: {},
    },
    codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    projects: {},
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
  const allowEgress = allowEgressResolved.value;
  const allowLlm = allowLlmResolved.value;

  const agentMemoryModeEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_MODE');
  const agentMemoryMode = firstDefined<string>([
    [nonEmpty(flags.agentMemoryMode), 'flag'],
    [agentMemoryModeEnv.value, agentMemoryModeEnv.source ?? 'process'],
    [fileConfig.agentMemory?.mode, 'config'],
    [defaults.agentMemory?.mode, 'default'],
  ]);
  const agentMemoryUrlEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_URL');
  const agentMemoryBaseUrl = firstDefined<string>([
    [nonEmpty(flags.agentMemoryBaseUrl), 'flag'],
    [agentMemoryUrlEnv.value, agentMemoryUrlEnv.source ?? 'process'],
    [fileConfig.agentMemory?.baseUrl, 'config'],
    [defaults.agentMemory?.baseUrl, 'default'],
  ]);
  const secretEnvVarEnv = sourceEnv('MEGA_BRAIN_AGENTMEMORY_SECRET_ENV');
  const secretEnvVar = firstDefined<string | null>([
    [nonEmpty(flags.agentMemorySecretEnvVar), 'flag'],
    [secretEnvVarEnv.value, secretEnvVarEnv.source ?? 'process'],
    [fileConfig.agentMemory?.secretEnvVar, 'config'],
    [null, 'default'],
  ]);

  let agentEnvironment: Record<string, string> = {};
  if (agentMemoryMode.value === 'managed') {
    agentEnvironment = {
      ...filterBackendEnvironment('agentMemory', fileConfig.agentMemory?.environment ?? {}),
      ...filterBackendEnvironment(
        'agentMemory',
        parseJsonRecord(envFromFile.MEGA_BRAIN_AGENTMEMORY_ENV_JSON, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
      ),
      ...directAgentMemoryEnvironment(envFromFile),
      ...filterBackendEnvironment(
        'agentMemory',
        parseJsonRecord(processEnvironment.MEGA_BRAIN_AGENTMEMORY_ENV_JSON, 'MEGA_BRAIN_AGENTMEMORY_ENV_JSON'),
      ),
      ...directAgentMemoryEnvironment(processEnvironment),
    };
    validateAgentMemoryOptIns(agentEnvironment, { allowEgress, allowLlm });
  }

  const referencedAgentMemoryToken = secretEnvVar.value === null
    ? undefined
    : nonEmpty(processEnvironment[secretEnvVar.value]);
  const explicitAgentMemoryToken = nonEmpty(processEnvironment.MEGA_BRAIN_AGENTMEMORY_TOKEN)
    ?? nonEmpty(envFromFile.MEGA_BRAIN_AGENTMEMORY_TOKEN)
    ?? nonEmpty(fileConfig.agentMemory?.authToken);
  const agentMemoryToken = referencedAgentMemoryToken
    ?? explicitAgentMemoryToken
    ?? (agentMemoryMode.value === 'managed' ? nonEmpty(agentEnvironment.AGENTMEMORY_SECRET) : undefined);

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
      ...(secretEnvVar.value === null ? {} : { secretEnvVar: secretEnvVar.value }),
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
      environment: {
        ...filterBackendEnvironment('codeReviewGraph', fileConfig.codeReviewGraph?.environment ?? {}),
        ...dotEnvCrgEnvironment,
        ...processCrgEnvironment,
      },
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
    'agentMemory.secretEnvVar': secretEnvVar.source,
    'agentMemory.ports.rest': agentMemoryPorts.rest.source,
    'agentMemory.ports.streams': agentMemoryPorts.streams.source,
    'agentMemory.ports.viewer': agentMemoryPorts.viewer.source,
    'agentMemory.ports.engine': agentMemoryPorts.engine.source,
    'codeReviewGraph.command': crgCommand.source,
    'codeReviewGraph.dataDir': crgDataDir.source,
  };
  return { config, sources };
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<MegaBrainConfig> {
  return (await loadConfigWithSources(options)).config;
}

export function redactConfig(config: MegaBrainConfig): Record<string, unknown> {
  return redactValue(config) as Record<string, unknown>;
}
