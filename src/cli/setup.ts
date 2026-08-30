import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadManagedDependencyVersions, redactConfig } from '../config/load.js';
import { projectConfigDocumentSchema, projectConfigSchema, projectConfigPath } from '../config/project-config.js';
import type { ProjectConfig } from '../config/project-config.js';
import type { ProjectConfigMetadata } from '../config/schema.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { redactText } from '../security/redaction.js';
import type { ManagedDependencyVersions } from '../runtime/dependency-versions.js';
import { createRuntimeIsolation } from '../runtime/lock-manifest.js';
import { runtimeLayout } from '../runtime/layout.js';
import { promptForHosts } from './host-selection.js';
import type { InstallPreflightResult } from './preflight.js';
import type { PromptAdapter } from './prompts.js';
import { formatChecklist, formatPreflight, formatSetupSummary, type CliChecklistItem } from './ui.js';

export type SetupHost = 'codex' | 'claude';

export interface SetupPlan {
  identity: ProjectIdentity;
  preflight: InstallPreflightResult;
  hosts: SetupHost[];
  codeReviewGraphMode: 'managed' | 'custom';
  strictIsolation: true;
  config: ProjectConfig;
  metadata: ProjectConfigMetadata;
  iiiEngineConfirmed: boolean;
  dependencyVersions: ManagedDependencyVersions;
  summary: Record<string, unknown>;
  reopenHost: true;
}

export interface SetupDependencies {
  prompts: PromptAdapter;
  currentDirectory: string;
  defaultDataDir: string;
  environment: NodeJS.ProcessEnv;
  preflight(repository: string): Promise<InstallPreflightResult>;
  discoverIdentity(repository: string): Promise<ProjectIdentity>;
  initializeGit?(repository: string): Promise<void>;
  probeRemote(input: { baseUrl: string; secret: string; identity: ProjectIdentity }): Promise<unknown>;
  install(plan: SetupPlan): Promise<void>;
}

export type SetupResult =
  | { status: 'cancelled' }
  | { status: 'unchanged'; plan: SetupPlan }
  | { status: 'installed'; plan: SetupPlan };

function errorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

async function runSetupTask<T>(prompts: PromptAdapter, message: string, run: () => Promise<T>): Promise<T> {
  if (prompts.withSpinner) return prompts.withSpinner(message, run);
  prompts.notify(message);
  return run();
}


function explain(prompts: PromptAdapter, message: string): void {
  if (prompts.explain) prompts.explain(message);
  else prompts.notify(message);
}

function hostLabel(host: SetupHost): string {
  return host === 'codex' ? 'Codex' : 'Claude Code';
}

function hostList(hosts: readonly SetupHost[]): string {
  return hosts.map(hostLabel).join(' and ');
}

function successChecklist(plan: SetupPlan): { items: CliChecklistItem[]; footer: string } {
  const hosts = hostList(plan.hosts);
  return {
    items: [
      { status: 'success', label: 'Runtime installed', detail: plan.config.agentMemory.mode === 'managed' ? 'managed local backend ready' : 'remote AgentMemory validated' },
      { status: 'success', label: 'Project configuration written', detail: '.mega-brain/config.json' },
      { status: 'success', label: 'MCP files configured', detail: hosts },
      { status: 'success', label: 'Host lifecycle hooks configured', detail: hosts },
      { status: 'success', label: 'Git hook integration configured', detail: plan.identity.gitBacked ? 'post-commit, post-checkout, post-merge, post-rewrite' : 'Git unavailable for this directory' },
      { status: 'success', label: 'Code Review Graph prepared', detail: plan.codeReviewGraphMode },
    ],
    footer: `Restart ${hosts} so the selected coding agent applications reload Mega Brain MCP files and hooks.`,
  };
}


interface CrgEnvironmentResult {
  environment: Record<string, string>;
  provider: string;
}

type SecretConsumerChoice = 'agentMemory' | 'codeReviewGraph' | 'both';

const secretConsumerChoices = [
  { value: 'agentMemory', label: 'AgentMemory only' },
  { value: 'codeReviewGraph', label: 'Code Review Graph only' },
  { value: 'both', label: 'AgentMemory and Code Review Graph' },
] as const;

async function captureSecret(
  prompts: PromptAdapter,
  id: string,
  label: string,
  environment: Record<string, string>,
  sharedSecrets: Record<string, string>,
  environmentKey: string,
  sharedEnvironmentKey: string | undefined,
): Promise<boolean | null> {
  const value = await prompts.input(id, label);
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let consumer: SecretConsumerChoice = 'agentMemory';
  if (sharedEnvironmentKey) {
    const selected = await prompts.select(
      `${id}Consumers`,
      `${environmentKey} consumers:`,
      secretConsumerChoices,
      'agentMemory',
    );
    if (selected === null) return null;
    consumer = selected;
  }
  if (consumer === 'agentMemory' || consumer === 'both') environment[environmentKey] = trimmed;
  if (sharedEnvironmentKey && (consumer === 'codeReviewGraph' || consumer === 'both')) {
    sharedSecrets[sharedEnvironmentKey] = trimmed;
  }
  return consumer === 'agentMemory' || consumer === 'both';
}

async function collectCrgEnvironment(
  prompts: PromptAdapter,
  options: { allowEgress: boolean; sharedSecrets: Record<string, string> },
): Promise<CrgEnvironmentResult | null> {
  const environment: Record<string, string> = {};

  const configureCrg = await prompts.confirm(
    'configureCrg',
    'Configure Code Review Graph embeddings?',
    true,
  );
  if (configureCrg === null) return null;
  if (!configureCrg) {
    return {
      environment: { CRG_EMBEDDING_MODEL: 'all-MiniLM-L6-v2' },
      provider: 'local (all-MiniLM-L6-v2)',
    };
  }

  explain(prompts,
    '### Code Review Graph Embeddings\n\n'
    + 'Configure vector embedding model for structural code graph nodes.\n'
    + 'See https://github.com/tirth8205/code-review-graph#environment-variables',
  );

  const crgChoices = options.allowEgress
    ? [
        { value: 'local', label: 'Local sentence-transformers (all-MiniLM-L6-v2, no API key)' },
        { value: 'openai', label: 'OpenAI / OpenAI-compatible (CRG_OPENAI_*)' },
        { value: 'google', label: 'Google Gemini' },
        { value: 'minimax', label: 'MiniMax' },
      ] as const
    : [
        { value: 'local', label: 'Local sentence-transformers (all-MiniLM-L6-v2, cloud skipped: requires allowEgress=true)' },
      ] as const;
  const provider = await prompts.select(
    'crgEmbeddingProvider',
    'Select Code Review Graph embedding provider:',
    crgChoices,
    'local',
  );
  if (provider === null) return null;

  if (provider === 'local') {
    environment.CRG_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
  } else if (provider === 'openai') {
    if (options.sharedSecrets.CRG_OPENAI_API_KEY) {
      environment.CRG_OPENAI_API_KEY = options.sharedSecrets.CRG_OPENAI_API_KEY;
    } else {
      const key = await prompts.input('crgOpenaiApiKey', 'CRG_OPENAI_API_KEY');
      if (key === null) return null;
      if (key.trim()) {
        environment.CRG_OPENAI_API_KEY = key.trim();
      }
    }
    const baseUrl = await prompts.input('crgOpenaiBaseUrl', 'CRG_OPENAI_BASE_URL (optional endpoint, e.g. http://127.0.0.1:3000/v1)');
    if (baseUrl === null) return null;
    if (baseUrl.trim()) {
      environment.CRG_OPENAI_BASE_URL = baseUrl.trim();
    }
    const model = await prompts.input('crgOpenaiModel', 'CRG_OPENAI_MODEL (required for OpenAI embeddings)', '');
    if (model === null) return null;
    if (!model.trim()) {
      prompts.notify('CRG_OPENAI_MODEL is required for OpenAI embeddings; no cloud model default is inserted.');
      return null;
    }
    environment.CRG_OPENAI_MODEL = model.trim();
    options.allowEgress = true;
  } else if (provider === 'google') {
    if (options.sharedSecrets.GOOGLE_API_KEY) {
      environment.GOOGLE_API_KEY = options.sharedSecrets.GOOGLE_API_KEY;
    } else {
      const key = await prompts.input('crgGoogleApiKey', 'GOOGLE_API_KEY');
      if (key === null) return null;
      if (key.trim()) {
        environment.GOOGLE_API_KEY = key.trim();
      }
    }
    options.allowEgress = true;
  } else if (provider === 'minimax') {
    if (options.sharedSecrets.MINIMAX_API_KEY) {
      environment.MINIMAX_API_KEY = options.sharedSecrets.MINIMAX_API_KEY;
    } else {
      const key = await prompts.input('crgMinimaxApiKey', 'MINIMAX_API_KEY');
      if (key === null) return null;
      if (key.trim()) {
        environment.MINIMAX_API_KEY = key.trim();
      }
    }
    options.allowEgress = true;
  }

  if (provider !== 'local') {
    environment.CRG_ACCEPT_CLOUD_EMBEDDINGS = '1';
  }

  return {
    environment,
    provider: provider === 'local' ? 'local (all-MiniLM-L6-v2)' : provider,
  };
}


interface ManagedEnvironmentResult {
  environment: Record<string, string>;
  sharedSecrets: Record<string, string>;
  llmProvider: string;
  embeddingProvider: string;
  featuresSummary?: string | undefined;
}

async function collectManagedEnvironment(
  prompts: PromptAdapter,
  options: { allowEgress: boolean; allowLlm: boolean },
): Promise<ManagedEnvironmentResult | null> {
  const environment: Record<string, string> = {};
  const sharedSecrets: Record<string, string> = {};

  const configureMemory = await prompts.confirm(
    'configureMemory',
    'Configure AgentMemory environment variables? (LLM keys, embeddings, features, tuning)',
    true,
  );
  if (configureMemory === null) return null;
  if (!configureMemory) {
    return {
      environment,
      sharedSecrets,
      llmProvider: 'none (local fastembed)',
      embeddingProvider: 'default (local BM25 + fastembed)',
    };
  }

  explain(prompts,
    '### AgentMemory environment\n\n'
    + 'Secrets stay in local `.mega-brain/config.json`; runtime receives only selected consumer variables.\n\n'
    + 'Leave blank to skip. See https://www.agent-memory.dev/docs/configuration',
  );

  const llmChoices = options.allowEgress && options.allowLlm
    ? [
        { value: 'none', label: 'None / Local only (BM25 + fastembed, zero external LLM)' },
        { value: 'anthropic', label: 'Anthropic (Claude)' },
        { value: 'openai', label: 'OpenAI (GPT)' },
        { value: 'gemini', label: 'Google Gemini' },
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'minimax', label: 'MiniMax' },
        { value: 'ollama', label: 'Ollama (local / self-hosted)' },
      ] as const
    : [
        { value: 'none', label: 'None / Local only (cloud prompts skipped: requires allowEgress=true and allowLlm=true)' },
        { value: 'ollama', label: 'Ollama (local / self-hosted)' },
      ] as const;
  const llmProvider = await prompts.select(
    'llmProvider',
    'Select LLM Provider (for summarization, graph extraction, observation compression):',
    llmChoices,
    'none',
  );
  if (llmProvider === null) return null;

  let hasLlm = false;
  if (llmProvider === 'anthropic') {
    const configured = await captureSecret(prompts, 'anthropicApiKey', 'ANTHROPIC_API_KEY', environment, sharedSecrets, 'ANTHROPIC_API_KEY', undefined);
    if (configured === null) return null;
    hasLlm = configured;
  } else if (llmProvider === 'openai') {
    const configured = await captureSecret(prompts, 'openaiApiKey', 'OPENAI_API_KEY', environment, sharedSecrets, 'OPENAI_API_KEY', 'CRG_OPENAI_API_KEY');
    if (configured === null) return null;
    hasLlm = configured;
  } else if (llmProvider === 'gemini') {
    const configured = await captureSecret(prompts, 'geminiApiKey', 'GEMINI_API_KEY', environment, sharedSecrets, 'GEMINI_API_KEY', 'GOOGLE_API_KEY');
    if (configured === null) return null;
    hasLlm = configured;
  } else if (llmProvider === 'openrouter') {
    const configured = await captureSecret(prompts, 'openrouterApiKey', 'OPENROUTER_API_KEY', environment, sharedSecrets, 'OPENROUTER_API_KEY', undefined);
    if (configured === null) return null;
    hasLlm = configured;
  } else if (llmProvider === 'minimax') {
    const configured = await captureSecret(prompts, 'minimaxApiKey', 'MINIMAX_API_KEY', environment, sharedSecrets, 'MINIMAX_API_KEY', 'MINIMAX_API_KEY');
    if (configured === null) return null;
    hasLlm = configured;
  } else if (llmProvider === 'ollama') {
    const host = await prompts.input('ollamaHost', 'OLLAMA_HOST', 'http://localhost:11434');
    if (host === null) return null;
    if (host.trim()) {
      environment.OLLAMA_HOST = host.trim();
      hasLlm = true;
    }
  }

  const embeddingChoices = options.allowEgress
    ? [
        { value: 'default', label: 'Default documented backend choice (local when unset)' },
        { value: 'local', label: 'Local fastembed (all-MiniLM-L6-v2 + BM25, no API key)' },
        { value: 'openai', label: 'OpenAI (text-embedding-3-small)' },
        { value: 'voyage', label: 'Voyage AI (voyage-code-3 / voyage-3-lite)' },
        { value: 'cohere', label: 'Cohere (embed-english-v3.0)' },
        { value: 'gemini', label: 'Google Gemini' },
      ] as const
    : [
        { value: 'default', label: 'Default documented backend choice (local; cloud skipped: requires allowEgress=true)' },
        { value: 'local', label: 'Local fastembed (all-MiniLM-L6-v2 + BM25, no API key)' },
      ] as const;
  const embeddingProviderChoice = await prompts.select(
    'embeddingProvider',
    'Select Embedding Provider for semantic search:',
    embeddingChoices,
    'default',
  );
  if (embeddingProviderChoice === null) return null;

  if (embeddingProviderChoice === 'openai' && !environment.OPENAI_API_KEY) {
    const configured = await captureSecret(prompts, 'openaiApiKey', 'OPENAI_API_KEY (for embeddings)', environment, sharedSecrets, 'OPENAI_API_KEY', 'CRG_OPENAI_API_KEY');
    if (configured === null) return null;
  } else if (embeddingProviderChoice === 'voyage') {
    const configured = await captureSecret(prompts, 'voyageApiKey', 'VOYAGE_API_KEY', environment, sharedSecrets, 'VOYAGE_API_KEY', undefined);
    if (configured === null) return null;
  } else if (embeddingProviderChoice === 'cohere') {
    const configured = await captureSecret(prompts, 'cohereApiKey', 'COHERE_API_KEY', environment, sharedSecrets, 'COHERE_API_KEY', undefined);
    if (configured === null) return null;
  } else if (embeddingProviderChoice === 'gemini' && !environment.GEMINI_API_KEY) {
    const configured = await captureSecret(prompts, 'geminiApiKey', 'GEMINI_API_KEY (for embeddings)', environment, sharedSecrets, 'GEMINI_API_KEY', 'GOOGLE_API_KEY');
    if (configured === null) return null;
  }

  if (embeddingProviderChoice !== 'default') {
    environment.EMBEDDING_PROVIDER = embeddingProviderChoice;
  }

  const activeFeatures: string[] = [];
  if (hasLlm) {
    const graphExtraction = await prompts.confirm(
      'graphExtraction',
      'Enable knowledge graph extraction? (requires LLM key)',
      false,
    );
    if (graphExtraction === null) return null;
    if (graphExtraction) {
      environment.GRAPH_EXTRACTION_ENABLED = 'true';
      activeFeatures.push('graph extraction');
    }

    const consolidation = await prompts.confirm(
      'consolidation',
      'Enable memory consolidation? (periodic summarization, requires LLM key)',
      false,
    );
    if (consolidation === null) return null;
    if (consolidation) {
      environment.CONSOLIDATION_ENABLED = 'true';
      activeFeatures.push('consolidation');
    }

    const autoCompress = await prompts.confirm(
      'autoCompress',
      'Enable LLM-powered observation compression? (costs tokens)',
      false,
    );
    if (autoCompress === null) return null;
    if (autoCompress) {
      environment.AGENTMEMORY_AUTO_COMPRESS = 'true';
      activeFeatures.push('observation compression');
    }

    const reflect = await prompts.confirm(
      'reflect',
      'Enable background reflection? (post-session synthesis of new patterns)',
      false,
    );
    if (reflect === null) return null;
    if (reflect) {
      environment.AGENTMEMORY_REFLECT = 'true';
      activeFeatures.push('reflection');
    }
  }

  const injectContext = await prompts.confirm(
    'injectContext',
    'Enable in-conversation context injection?',
    false,
  );
  if (injectContext === null) return null;
  if (injectContext) {
    environment.AGENTMEMORY_INJECT_CONTEXT = 'true';
    activeFeatures.push('context injection');
  }

  const snapshots = await prompts.confirm(
    'snapshots',
    'Enable session snapshots?',
    false,
  );
  if (snapshots === null) return null;
  if (snapshots) {
    environment.SNAPSHOT_ENABLED = 'true';
    activeFeatures.push('snapshots');
  }

  const advancedMemory = await prompts.confirm(
    'advancedMemory',
    'Configure search tuning, runtime knobs, and bridges?',
    true,
  );
  if (advancedMemory === null) return null;
  if (advancedMemory) {
    const graphWeight = await prompts.input('graphWeight', 'Search graph weight (0.0 to 1.0)', '0.2');
    if (graphWeight === null) return null;
    if (graphWeight.trim() && graphWeight.trim() !== '0.2') {
      const parsed = Number(graphWeight.trim());
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        environment.AGENTMEMORY_GRAPH_WEIGHT = graphWeight.trim();
      }
    }

    const dropStaleIndex = await prompts.confirm('dropStaleIndex', 'Drop stale vector indices on startup?', false);
    if (dropStaleIndex === null) return null;
    if (dropStaleIndex) {
      environment.AGENTMEMORY_DROP_STALE_INDEX = 'true';
    }

    const imageEmbeddings = await prompts.confirm('imageEmbeddings', 'Enable image embeddings for multimodal memories?', true);
    if (imageEmbeddings === null) return null;
    if (imageEmbeddings) {
      environment.AGENTMEMORY_IMAGE_EMBEDDINGS = 'true';
    }

    const debugMode = await prompts.confirm('debugMode', 'Enable AgentMemory debug logging?', true);
    if (debugMode === null) return null;
    if (debugMode) {
      environment.AGENTMEMORY_DEBUG = 'true';
    }

    const projectName = await prompts.input('projectName', 'Custom project namespace (AGENTMEMORY_PROJECT_NAME, leave blank for auto)', '');
    if (projectName === null) return null;
    if (projectName.trim()) {
      environment.AGENTMEMORY_PROJECT_NAME = projectName.trim();
    }

    const agentScope = await prompts.select(
      'agentScope',
      'AgentMemory scope (AGENTMEMORY_AGENT_SCOPE):',
      [
        { value: 'shared', label: 'Shared (backend default)' },
        { value: 'isolated', label: 'Isolated per agent' },
      ] as const,
      'shared',
    );
    if (agentScope === null) return null;
    if (agentScope !== 'shared') {
      environment.AGENTMEMORY_AGENT_SCOPE = agentScope;
      const agentId = await prompts.input('agentId', 'AGENT_ID (required for isolated scope)');
      if (agentId === null) return null;
      if (!agentId.trim()) {
        prompts.notify('AGENT_ID is required when AGENTMEMORY_AGENT_SCOPE=isolated.');
        return null;
      }
      environment.AGENT_ID = agentId.trim();
    }

    const bridges = await prompts.confirm('bridges', 'Configure IDE editor bridges (Claude Code, Cursor, Windsurf, Cline)?', false);
    if (bridges === null) return null;
    if (bridges) {
      const claudeBridge = await prompts.confirm('claudeBridge', 'Enable Claude Code bridge?', false);
      if (claudeBridge) {
        environment.AGENTMEMORY_CLAUDE_CODE_BRIDGE = 'true';
      }
      const cursorBridge = await prompts.confirm('cursorBridge', 'Enable Cursor bridge?', false);
      if (cursorBridge) {
        environment.AGENTMEMORY_CURSOR_BRIDGE = 'true';
      }
      const windsurfBridge = await prompts.confirm('windsurfBridge', 'Enable Windsurf bridge?', false);
      if (windsurfBridge) {
        environment.AGENTMEMORY_WINDSURF_BRIDGE = 'true';
      }
      const clineBridge = await prompts.confirm('clineBridge', 'Enable Cline bridge?', false);
      if (clineBridge) {
        environment.AGENTMEMORY_CLINE_BRIDGE = 'true';
      }
    }
  }

  const needsEgress = Object.keys(environment).some((key) =>
    /API_KEY$/u.test(key),
  ) || ['openai', 'voyage', 'cohere', 'gemini'].includes(embeddingProviderChoice)
    || ['anthropic', 'openai', 'gemini', 'openrouter', 'minimax'].includes(llmProvider);

  const needsLlm = hasLlm || Object.keys(environment).some((key) =>
    ['GRAPH_EXTRACTION_ENABLED', 'CONSOLIDATION_ENABLED', 'AGENTMEMORY_AUTO_COMPRESS', 'AGENTMEMORY_REFLECT'].includes(key),
  );

  if (needsEgress && !options.allowEgress) options.allowEgress = true;
  if (needsLlm && !options.allowLlm) options.allowLlm = true;

  return {
    environment,
    sharedSecrets,
    llmProvider: hasLlm ? llmProvider : 'none (local fastembed)',
    embeddingProvider: embeddingProviderChoice === 'default' ? 'default (auto)' : embeddingProviderChoice,
    featuresSummary: activeFeatures.length > 0 ? activeFeatures.join(', ') : undefined,
  };
}

function failureChecklist(plan: SetupPlan, error: unknown): { items: CliChecklistItem[]; footer: string } {
  const hosts = hostList(plan.hosts);
  return {
    items: [
      { status: 'error', label: 'Installation failed', detail: errorMessage(error) },
      { status: 'info', label: 'Selected hosts', detail: hosts },
      { status: 'info', label: 'Repository', detail: plan.identity.root },
    ],
    footer: `Fix the error above, then rerun with MEGA_BRAIN_LOG_LEVEL=debug mega-brain setup --repo "${plan.identity.root}" to capture full diagnostic logs.`,
  };
}

async function readExistingProjectConfig(repositoryRoot: string): Promise<ProjectConfig | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(projectConfigPath(repositoryRoot), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'effective' in parsed) {
      return projectConfigDocumentSchema.parse(parsed).effective;
    }
    return projectConfigSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Existing .mega-brain/config.json is invalid: ${errorMessage(error)}`);
  }
}

function mergeExistingProjectConfig(existing: ProjectConfig | undefined, current: ProjectConfig, preserveExisting: boolean): ProjectConfig {
  if (!existing || !preserveExisting) return current;
  return projectConfigSchema.parse({
    ...current,
    agentMemory: {
      ...current.agentMemory,
      ...(current.agentMemory.mode === 'remote' ? { authToken: current.agentMemory.authToken } : { authToken: undefined }),
      environment: { ...existing.agentMemory.environment, ...current.agentMemory.environment },
    },
    codeReviewGraph: {
      ...current.codeReviewGraph,
      environment: { ...existing.codeReviewGraph.environment, ...current.codeReviewGraph.environment },
    },
    projects: { ...existing.projects, ...current.projects },
  });
}

function configurationDiff(existing: ProjectConfig | undefined, current: ProjectConfig): Array<readonly [string, string, string, string]> {
  if (!existing) return [['Configuration', 'not configured', 'configured', 'applied']];
  const before = redactConfig(existing) as unknown as Record<string, unknown>;
  const after = redactConfig(current) as unknown as Record<string, unknown>;
  const rows: Array<readonly [string, string, string, string]> = [];
  const compare = (prefix: string, left: unknown, right: unknown): void => {
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const keys = new Set([...Object.keys(left as Record<string, unknown>), ...Object.keys(right as Record<string, unknown>)]);
      for (const key of keys) compare(prefix ? `${prefix}.${key}` : key, (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]);
      return;
    }
    const leftValue = left === undefined ? 'unset' : String(left);
    const rightValue = right === undefined ? 'unset' : String(right);
    if (leftValue !== rightValue) rows.push([prefix, leftValue, rightValue, 'changed']);
  };
  compare('', before, after);
  return rows;
}



export async function runSetupWizard(dependencies: SetupDependencies): Promise<SetupResult> {
  const { prompts } = dependencies;
  if (!prompts.interactive) {
    throw new Error('mega-brain setup requires an interactive terminal');
  }

  await prompts.intro?.();

  let identity: ProjectIdentity;
  let preflight: InstallPreflightResult;
  let dependencyVersions!: ManagedDependencyVersions;
  let existingConfig: ProjectConfig | undefined;
  let resetExisting = false;
  while (true) {
    const repository = await prompts.input('repository', 'Repository directory', dependencies.currentDirectory);
    if (repository === null) return { status: 'cancelled' };
    const resolved = path.resolve(repository);
    try {
      preflight = await runSetupTask(prompts, `Checking prerequisites for ${resolved}`, () => dependencies.preflight(resolved));
      identity = await runSetupTask(prompts, 'Detecting project identity', () => dependencies.discoverIdentity(resolved));
      dependencyVersions = (await runSetupTask(prompts, 'Resolving managed dependency versions', () => loadManagedDependencyVersions({ repoPath: resolved, env: dependencies.environment }))).versions;
      if (!identity.gitBacked) {
        prompts.notify('No Git repository found. Mega Brain setup requires Git for managed Code Review Graph, Git hooks, and Git-backed evidence.');
        const action = await prompts.select('nonGitRepositoryAction', 'How should setup continue?', [
          { value: 'init', label: 'Initialize Git repository with git init' },
          { value: 'retry', label: 'Try again after I initialize Git myself' },
          { value: 'cancel', label: 'Cancel setup' },
        ] as const, 'init');
        if (action === null || action === 'cancel') return { status: 'cancelled' };
        if (action === 'init') {
          if (!dependencies.initializeGit) throw new Error('Git initialization is unavailable in this setup environment');
          await runSetupTask(prompts, 'Initializing Git repository', () => dependencies.initializeGit!(resolved));
          prompts.notify('Git repository initialized. Rechecking project identity.');
        }
        continue;
      }
      prompts.notify(formatPreflight(preflight));
      existingConfig = await readExistingProjectConfig(resolved);
      if (existingConfig) {
        const reset = await prompts.confirm(
          'resetExisting',
          '[IMPORTANT] Existing Mega Brain configuration found. Reset existing values to defaults?',
          false,
        );
        if (reset === null) return { status: 'cancelled' };
        resetExisting = reset;
        if (resetExisting) prompts.notify('Existing configuration will be replaced after confirmation.');
      }
      break;
    } catch (error) {
      prompts.notify(`Preflight failed: ${errorMessage(error)}`);
    }
  }

  const preservedConfig = existingConfig && !resetExisting ? existingConfig : undefined;
  const selectedHosts = await promptForHosts(prompts);
  if (selectedHosts === null) return { status: 'cancelled' };
  if (selectedHosts.length === 0) {
    prompts.notify('Select at least one host to configure.');
    return { status: 'cancelled' };
  }

  let agentMemory: { mode: 'managed' } | { mode: 'remote'; baseUrl: string; authToken: string };
  while (true) {
    const mode = await prompts.select('agentMemoryMode', 'AgentMemory mode?', [
      { value: 'managed', label: 'Managed locally' },
      { value: 'remote', label: 'Existing remote service' },
    ] as const, preservedConfig?.agentMemory.mode ?? 'managed');
    if (mode === null) return { status: 'cancelled' };
    if (mode === 'managed') {
      agentMemory = { mode: 'managed' };
      break;
    }
    const baseUrl = await prompts.input('remoteUrl', 'Remote AgentMemory URL', preservedConfig?.agentMemory.mode === 'remote' ? preservedConfig.agentMemory.baseUrl : '');
    if (baseUrl === null) return { status: 'cancelled' };
    const enteredAuthToken = await prompts.input('remoteAuthToken', 'Remote AgentMemory secret token');
    if (enteredAuthToken === null) return { status: 'cancelled' };
    const authToken = enteredAuthToken.trim() || (preservedConfig?.agentMemory.mode === 'remote' ? preservedConfig.agentMemory.authToken ?? '' : '');
    try {
      new URL(baseUrl);
      if (!authToken.trim()) throw new Error('Remote AgentMemory secret token cannot be empty');
      await runSetupTask(prompts, 'Validating remote AgentMemory isolation', () => dependencies.probeRemote({ baseUrl, secret: authToken, identity }));
      agentMemory = { mode: 'remote', baseUrl, authToken };
      break;
    } catch (error) {
      prompts.notify(`Remote validation failed: ${errorMessage(error)}. Try again or choose managed.`);
    }
  }

  const advanced = await prompts.confirm('advanced', ' Configure advanced options?', true);
  if (advanced === null) return { status: 'cancelled' };
  let dataDir = preservedConfig?.dataDir ?? path.resolve(dependencies.defaultDataDir);
  let crgCommand = preservedConfig?.codeReviewGraph.command ?? 'code-review-graph';
  let codeReviewGraphMode: 'managed' | 'custom' = crgCommand === 'code-review-graph' ? 'managed' : 'custom';
  let allowEgress = preservedConfig?.allowEgress ?? false;
  let allowLlm = preservedConfig?.allowLlm ?? false;
  if (advanced) {
    const selectedDataDir = await prompts.input('dataDir', 'Data root', dataDir);
    if (selectedDataDir === null) return { status: 'cancelled' };
    dataDir = path.resolve(identity.root, selectedDataDir);
    const crgMode = await prompts.select('crgMode', 'Code Review Graph mode?', [
      { value: 'managed', label: 'Managed pinned version' },
      { value: 'custom', label: 'Custom compatible command' },
    ] as const, 'managed');
    if (crgMode === null) return { status: 'cancelled' };
    if (crgMode === 'custom') {
      codeReviewGraphMode = 'custom';
      const selectedCommand = await prompts.input('crgCommand', 'Code Review Graph command');
      if (selectedCommand === null) return { status: 'cancelled' };
      if (!selectedCommand.trim()) { prompts.notify('Code Review Graph command cannot be empty'); return { status: 'cancelled' }; }
      crgCommand = selectedCommand;
    }
    explain(prompts,
      '### Network & Privacy\n\n'
      + '• **Network Egress**: Allows Mega Brain adapters to make outbound HTTPS calls to external LLM & embedding providers (OpenAI, Voyage, Google, Cohere, Anthropic, MiniMax).\n'
      + '• **If Disabled**: Provider and adapter calls stay local using fastembed/sentence-transformers. Dependency registry access and downloads remain separate control-plane operations.',
    );
    const egressConsent = await prompts.confirm(
      'allowEgress',
      '[IMPORTANT] Allow network egress for external providers? Review transmission and cost risk.',
      preservedConfig?.allowEgress ?? true,
    );
    if (egressConsent === null) return { status: 'cancelled' };
    allowEgress = egressConsent;
    if (allowEgress) {
      const llmConsent = await prompts.confirm(
        'allowLlm',
        '[IMPORTANT] Allow LLM providers? Review transmission and token cost risk.',
        preservedConfig?.allowLlm ?? true,
      );
      if (llmConsent === null) return { status: 'cancelled' };
      allowLlm = llmConsent;
    }
  }

  let managedEnvResult: ManagedEnvironmentResult = {
    environment: {},
    sharedSecrets: {},
    llmProvider: 'none (local fastembed)',
    embeddingProvider: 'default (local BM25 + fastembed)',
  };
  if (agentMemory.mode === 'managed') {
    const mutableOpts = { allowEgress, allowLlm };
    const result = await collectManagedEnvironment(prompts, mutableOpts);
    if (result === null) return { status: 'cancelled' };
    managedEnvResult = result;
    allowEgress = mutableOpts.allowEgress;
    allowLlm = mutableOpts.allowLlm;
  }


  let crgEnvResult: CrgEnvironmentResult = {
    environment: { CRG_EMBEDDING_MODEL: 'all-MiniLM-L6-v2' },
    provider: 'local (all-MiniLM-L6-v2)',
  };
  const crgMutableOpts = { allowEgress, sharedSecrets: managedEnvResult.sharedSecrets };
  const crgResult = await collectCrgEnvironment(prompts, crgMutableOpts);
  if (crgResult === null) return { status: 'cancelled' };
  crgEnvResult = crgResult;
  allowEgress = crgMutableOpts.allowEgress || allowEgress;

  const isolation = createRuntimeIsolation(runtimeLayout(dataDir, identity), identity.worktreeId);
  const currentConfig: ProjectConfig = {
    dataDir,
    port: preservedConfig?.port ?? 3000,
    logLevel: preservedConfig?.logLevel ?? 'info',
    allowEgress,
    allowLlm,
    agentMemory: {
      mode: agentMemory.mode,
      baseUrl: agentMemory.mode === 'managed'
        ? preservedConfig?.agentMemory.mode === 'managed' ? preservedConfig.agentMemory.baseUrl : `http://127.0.0.1:${isolation.ports.rest}`
        : agentMemory.baseUrl,
      ...(agentMemory.mode === 'remote' ? { authToken: agentMemory.authToken } : {}),
      ports: preservedConfig?.agentMemory.ports ?? isolation.ports,
      environment: managedEnvResult.environment,
    },
    codeReviewGraph: {
      command: crgCommand,
      args: preservedConfig?.codeReviewGraph.args ?? [],
      dataDir: advanced ? isolation.paths.codeReviewGraph : preservedConfig?.codeReviewGraph.dataDir ?? isolation.paths.codeReviewGraph,
      environment: crgEnvResult.environment,
    },
    projects: {},
  };
  const config = mergeExistingProjectConfig(preservedConfig, currentConfig, Boolean(preservedConfig));
  const iiiEngineConfirmed = preflight.managedIiiEngineRequired && agentMemory.mode === 'managed'
    ? await prompts.confirm('iiiEngine', ` Download and verify iii-engine ${dependencyVersions.iiiEngine} inside this project runtime?`, true)
    : false;
  if (iiiEngineConfirmed === null) return { status: 'cancelled' };
  if (preflight.managedIiiEngineRequired && agentMemory.mode === 'managed' && !iiiEngineConfirmed) {
    prompts.notify('iii-engine confirmation is required for managed AgentMemory on Windows');
    return { status: 'cancelled' };
  }
  const configuredEnvironments = {
    agentMemory: managedEnvResult.environment,
    codeReviewGraph: crgEnvResult.environment,
  };
  const environmentStatus = Object.fromEntries(
    Object.entries(configuredEnvironments).flatMap(([consumer, values]) =>
      Object.keys(values).map((key) => [`${consumer}.environment.${key}`, 'configured' as const])),
  );
  const cloudProviders = new Set<string>();
  if (['anthropic', 'openai', 'gemini', 'openrouter', 'minimax'].includes(managedEnvResult.llmProvider)) {
    cloudProviders.add(managedEnvResult.llmProvider);
  }
  if (['openai', 'voyage', 'cohere', 'gemini'].includes(managedEnvResult.embeddingProvider)) {
    cloudProviders.add(managedEnvResult.embeddingProvider);
  }
  if (crgEnvResult.provider !== 'local (all-MiniLM-L6-v2)') cloudProviders.add(crgEnvResult.provider);
  const metadata: ProjectConfigMetadata = {
    sources: {
      dataDir: advanced ? 'user' : preservedConfig ? 'existing' : 'default',
      port: preservedConfig ? 'existing' : 'default',
      logLevel: preservedConfig ? 'existing' : 'default',
      allowEgress: advanced ? 'user' : preservedConfig ? 'existing' : 'default',
      allowLlm: advanced ? 'user' : preservedConfig ? 'existing' : 'default',
      'agentMemory.mode': 'user',
      'agentMemory.baseUrl': agentMemory.mode === 'remote' ? 'user' : preservedConfig ? 'existing' : 'inferred',
      'agentMemory.ports': preservedConfig ? 'existing' : 'inferred',
      'codeReviewGraph.command': advanced ? 'user' : preservedConfig ? 'existing' : 'default',
      'codeReviewGraph.args': preservedConfig ? 'existing' : 'default',
      'codeReviewGraph.dataDir': advanced ? 'inferred' : preservedConfig ? 'existing' : 'inferred',
      'agentMemory.environment': 'user',
      'codeReviewGraph.environment': 'user',
    },
    status: environmentStatus,
    consents: {
      allowEgress,
      allowLlm,
      cloudProviders: [...cloudProviders],
      customVersions: {},
    },
  };
  if (preservedConfig) {
    for (const [consumer, values] of [
      ['agentMemory', preservedConfig.agentMemory.environment],
      ['codeReviewGraph', preservedConfig.codeReviewGraph.environment],
    ] as const) {
      for (const key of Object.keys(values)) {
        const sourceKey = `${consumer}.environment.${key}`;
        if (!Object.hasOwn(metadata.sources, sourceKey)) metadata.sources[sourceKey] = 'existing';
        if (!Object.hasOwn(metadata.status, sourceKey)) metadata.status[sourceKey] = 'configured';
      }
    }
    if (!advanced) {
      metadata.sources.dataDir = 'existing';
      metadata.sources.allowEgress = 'existing';
      metadata.sources.allowLlm = 'existing';
      metadata.sources['agentMemory.mode'] = 'existing';
      metadata.sources['codeReviewGraph.environment'] = 'existing';
    }
  }
  const diff = configurationDiff(preservedConfig, config);
  const summary = {
    repository: identity.root,
    hosts: selectedHosts,
    codeReviewGraphMode,
    agentMemory: agentMemory.mode,
    ...(agentMemory.mode === 'managed' ? {
      llmProvider: managedEnvResult.llmProvider,
      embeddingProvider: managedEnvResult.embeddingProvider,
      ...(managedEnvResult.featuresSummary ? { agentMemoryFeatures: managedEnvResult.featuresSummary } : {}),
    } : {}),
    codeReviewGraph: crgCommand === 'code-review-graph' ? 'managed' : 'custom',
    crgEmbeddingProvider: crgEnvResult.provider,
    dataDir,
    strictIsolation: true,
    allowEgress,
    allowLlm,
    dependencyVersions,
    effective: redactConfig(config),
    sources: metadata.sources,
    status: metadata.status,
    consents: metadata.consents,
    diff,
  };
  prompts.notify(formatSetupSummary(summary));
  const plan: SetupPlan = {
    identity,
    preflight,
    hosts: selectedHosts,
    codeReviewGraphMode,
    strictIsolation: true,
    config,
    metadata,
    iiiEngineConfirmed,
    dependencyVersions,
    summary,
    reopenHost: true,
  };
  if (diff.length === 0) return { status: 'unchanged', plan };

  const confirmed = await prompts.confirm('confirm', 'Apply this setup?', true);
  if (!confirmed) return { status: 'cancelled' };

  try {
    await dependencies.install(plan);
  } catch (error) {
    const failure = failureChecklist(plan, error);
    prompts.notify(formatChecklist('Setup failed', failure.items, failure.footer));
    throw error;
  }
  const success = successChecklist(plan);
  prompts.notify(formatChecklist('Setup complete', success.items, success.footer));
  return { status: 'installed', plan };
}
