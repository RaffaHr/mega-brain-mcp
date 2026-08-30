export type EnvironmentCatalogGroup = 'Core' | 'Embedding' | 'LLM' | 'Runtime' | 'Bridges' | 'Advanced';
export type EnvironmentDefaultKind = 'value' | 'unset';
export type EnvironmentConsumer = 'agentMemory' | 'codeReviewGraph';

export interface BackendEnvironmentCatalogEntry {
  readonly key: string;
  readonly group: EnvironmentCatalogGroup;
  readonly type: 'boolean' | 'number' | 'string' | 'url' | 'secret' | 'enum';
  readonly defaultKind: EnvironmentDefaultKind;
  readonly defaultValue?: string;
  readonly allowedValues?: readonly string[];
  readonly secret: boolean;
  readonly consumers: readonly EnvironmentConsumer[];
  readonly requires?: readonly ('allowEgress' | 'allowLlm' | 'provider')[];
  readonly forwarded: boolean;
  readonly description: string;
}

const AM: readonly EnvironmentConsumer[] = ['agentMemory'];
const CRG: readonly EnvironmentConsumer[] = ['codeReviewGraph'];
const BOTH: readonly EnvironmentConsumer[] = ['agentMemory', 'codeReviewGraph'];
const entry = (
  key: string,
  group: EnvironmentCatalogGroup,
  type: BackendEnvironmentCatalogEntry['type'],
  options: Partial<Omit<BackendEnvironmentCatalogEntry, 'key' | 'group' | 'type'>> = {},
): BackendEnvironmentCatalogEntry => ({
  key,
  group,
  type,
  defaultKind: 'unset',
  secret: false,
  consumers: AM,
  forwarded: true,
  description: `Managed backend setting ${key}`,
  ...options,
});

export const BACKEND_ENVIRONMENT_CATALOG_VERSION = Object.freeze({
  agentMemory: '0.9.29',
  codeReviewGraph: '2.3.7',
});
export const BACKEND_ENVIRONMENT_CATALOG: readonly BackendEnvironmentCatalogEntry[] = [
  entry('AGENTMEMORY_PROVIDER', 'LLM', 'enum', { allowedValues: ['anthropic', 'openai', 'gemini', 'openrouter', 'minimax', 'ollama'], forwarded: false }),
  entry('EMBEDDING_PROVIDER', 'Embedding', 'enum', { defaultKind: 'value', defaultValue: 'local', allowedValues: ['local', 'openai', 'voyage', 'cohere', 'gemini', 'openrouter'], requires: ['provider'] }),
  entry('AGENTMEMORY_AGENT_SCOPE', 'Core', 'enum', { defaultKind: 'value', defaultValue: 'shared', allowedValues: ['shared', 'isolated'], description: 'Memory visibility scope across managed agents' }),
  entry('AGENT_ID', 'Core', 'string', { description: 'Required managed agent identity when scope is isolated' }),
  entry('AGENTMEMORY_PROJECT_NAME', 'Core', 'string'),
  entry('AGENTMEMORY_SECRET', 'Core', 'secret', { secret: true }),
  entry('AGENTMEMORY_TOOLS', 'Core', 'enum', { defaultKind: 'value', defaultValue: 'all', allowedValues: ['all', 'core'] }),
  entry('GRAPH_EXTRACTION_ENABLED', 'LLM', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('CONSOLIDATION_ENABLED', 'LLM', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_AUTO_COMPRESS', 'LLM', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_REFLECT', 'LLM', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_INJECT_CONTEXT', 'Core', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('SNAPSHOT_ENABLED', 'Core', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_GRAPH_WEIGHT', 'Embedding', 'number', { defaultKind: 'value', defaultValue: '0.2' }),
  entry('AGENTMEMORY_DROP_STALE_INDEX', 'Embedding', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_IMAGE_EMBEDDINGS', 'Embedding', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['provider'] }),
  entry('EMBEDDING_MODEL', 'Embedding', 'string', { requires: ['provider'] }),
  entry('ANTHROPIC_API_KEY', 'LLM', 'secret', { secret: true, requires: ['allowEgress', 'allowLlm'] }),
  entry('OPENAI_API_KEY', 'LLM', 'secret', { secret: true, requires: ['allowEgress', 'allowLlm'] }),
  entry('GEMINI_API_KEY', 'LLM', 'secret', { secret: true, requires: ['allowEgress', 'allowLlm'] }),
  entry('GOOGLE_API_KEY', 'Embedding', 'secret', { secret: true, consumers: CRG, requires: ['allowEgress'] }),
  entry('OPENROUTER_API_KEY', 'LLM', 'secret', { secret: true, requires: ['allowEgress', 'allowLlm'] }),
  entry('MINIMAX_API_KEY', 'LLM', 'secret', { secret: true, consumers: BOTH, requires: ['allowEgress', 'allowLlm'] }),
  entry('VOYAGE_API_KEY', 'Embedding', 'secret', { secret: true, requires: ['allowEgress'] }),
  entry('COHERE_API_KEY', 'Embedding', 'secret', { secret: true, requires: ['allowEgress'] }),
  entry('OLLAMA_HOST', 'LLM', 'url', { defaultKind: 'value', defaultValue: 'http://localhost:11434' }),
  entry('AGENTMEMORY_CLAUDE_CODE_BRIDGE', 'Bridges', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_CURSOR_BRIDGE', 'Bridges', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_WINDSURF_BRIDGE', 'Bridges', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_CLINE_BRIDGE', 'Bridges', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_DEBUG', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_VERBOSE', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_ALLOW_AGENT_SDK', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_CHEAP_MODEL', 'Advanced', 'string', { requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_MODEL', 'Advanced', 'string', { requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_LLM_NOTHINK', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_LLM_TIMEOUT_MS', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '60000', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_CONSOLIDATION_COOLDOWN_MS', 'Advanced', 'number'),
  entry('AGENTMEMORY_FOLLOWUP_WINDOW_SECONDS', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '30' }),
  entry('AGENTMEMORY_PROBE_TIMEOUT_MS', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '2000' }),
  entry('AGENTMEMORY_FORCE_PROXY', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('AGENTMEMORY_SLOTS', 'Advanced', 'string'),
  entry('AGENTMEMORY_SUPPRESS_COST_WARNING', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false', requires: ['allowEgress', 'allowLlm'] }),
  entry('AGENTMEMORY_DATA_DIR', 'Runtime', 'string'),
  entry('AGENTMEMORY_EXPORT_ROOT', 'Runtime', 'string', { defaultKind: 'value', defaultValue: '~/.agentmemory' }),
  entry('AGENTMEMORY_IMAGE_STORE_MAX_BYTES', 'Runtime', 'number'),
  entry('AGENTMEMORY_METRICS_PORT', 'Runtime', 'number'),
  entry('AGENTMEMORY_VIEWER_HOST', 'Runtime', 'string'),
  entry('AGENTMEMORY_VIEWER_URL', 'Runtime', 'url', { defaultKind: 'value', defaultValue: 'http://localhost:3113' }),
  entry('AGENTMEMORY_III_CONFIG', 'Runtime', 'string'),
  entry('AGENTMEMORY_USE_DOCKER', 'Runtime', 'boolean'),
  entry('AGENTMEMORY_DOCKER_UID', 'Runtime', 'number'),
  entry('AGENTMEMORY_DOCKER_GID', 'Runtime', 'number'),
  entry('AGENTMEMORY_DOCKER_SKIP_CHOWN', 'Runtime', 'boolean', { defaultKind: 'value', defaultValue: 'false' }),
  entry('CRG_EMBEDDING_MODEL', 'Embedding', 'string', { defaultKind: 'value', defaultValue: 'all-MiniLM-L6-v2', consumers: CRG }),
  entry('CRG_OPENAI_API_KEY', 'Embedding', 'secret', { secret: true, consumers: CRG, requires: ['allowEgress'] }),
  entry('CRG_OPENAI_BASE_URL', 'Embedding', 'url', { consumers: CRG, requires: ['allowEgress'] }),
  entry('CRG_OPENAI_MODEL', 'Embedding', 'string', { consumers: CRG, requires: ['allowEgress'] }),
  entry('CRG_OPENAI_DIMENSION', 'Advanced', 'number', { consumers: CRG }),
  entry('CRG_OPENAI_BATCH_SIZE', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '100', consumers: CRG }),
  entry('CRG_ACCEPT_CLOUD_EMBEDDINGS', 'Embedding', 'string', { consumers: CRG, requires: ['allowEgress'] }),
  entry('CRG_GIT_TIMEOUT', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '30', consumers: CRG }),
  entry('CRG_DATA_DIR', 'Runtime', 'string', { consumers: CRG }),
  entry('CRG_ALLOW_REMOTE_CODE', 'Advanced', 'enum', { defaultKind: 'value', defaultValue: '0', allowedValues: ['0', '1'], consumers: CRG }),
  entry('CRG_MAX_IMPACT_NODES', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '500', consumers: CRG }),
  entry('CRG_MAX_IMPACT_DEPTH', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '2', consumers: CRG }),
  entry('CRG_MAX_BFS_DEPTH', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '15', consumers: CRG }),
  entry('CRG_MAX_CHANGED_FUNCS', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '500', consumers: CRG }),
  entry('CRG_MAX_TRANSITIVE_FRONTIER', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '50', consumers: CRG }),
  entry('CRG_TOOL_TIMEOUT', 'Advanced', 'number', { defaultKind: 'value', defaultValue: '0', consumers: CRG }),
  entry('CRG_RECURSE_SUBMODULES', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false', consumers: CRG }),
  entry('CRG_TOOLS', 'Advanced', 'string', { consumers: CRG }),
  entry('CRG_SERIAL_PARSE', 'Advanced', 'boolean', { defaultKind: 'value', defaultValue: 'false', consumers: CRG }),
] as const;

export const BACKEND_ENVIRONMENT_CATALOG_BY_KEY = new Map(
  BACKEND_ENVIRONMENT_CATALOG.map((item) => [item.key, item] as const),
);
