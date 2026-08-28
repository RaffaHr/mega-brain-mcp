import path from 'node:path';

import { readFile, writeFile } from 'node:fs/promises';
import { loadManagedDependencyVersions } from '../config/load.js';
import type { ProjectConfig } from '../config/project-config.js';
import type { ProjectIdentity } from '../projects/identity.js';
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
  iiiEngineConfirmed: boolean;
  dependencyVersions: ManagedDependencyVersions;
  summary: Record<string, unknown>;
  reopenHost: true;
  envFileEntries: Record<string, string>;
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
  writeEnvFile?(root: string, entries: Record<string, string>): Promise<void>;
}

export type SetupResult = { status: 'cancelled' } | { status: 'installed'; plan: SetupPlan };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSetupTask<T>(prompts: PromptAdapter, message: string, run: () => Promise<T>): Promise<T> {
  if (prompts.withSpinner) return prompts.withSpinner(message, run);
  prompts.notify(message);
  return run();
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
      ...(Object.keys(plan.envFileEntries).length > 0
        ? [{ status: 'success' as const, label: 'Environment variables written', detail: '.env' }]
        : []),
    ],
    footer: `Restart ${hosts} so the selected coding agent applications reload Mega Brain MCP files and hooks.`,
  };
}


interface CrgEnvironmentResult {
  environment: Record<string, string>;
  envFileEntries: Record<string, string>;
  provider: string;
}

async function collectCrgEnvironment(
  prompts: PromptAdapter,
  options: { allowEgress: boolean },
): Promise<CrgEnvironmentResult | null> {
  const environment: Record<string, string> = {};
  const envFileEntries: Record<string, string> = {};

  const configureCrg = await prompts.confirm(
    'configureCrg',
    'Configure Code Review Graph embeddings?',
    false,
  );
  if (configureCrg === null) return null;
  if (!configureCrg) {
    return {
      environment: { CRG_EMBEDDING_MODEL: 'all-MiniLM-L6-v2' },
      envFileEntries: {},
      provider: 'local (all-MiniLM-L6-v2)',
    };
  }

  prompts.notify(
    '### Code Review Graph Embeddings\n\n'
    + 'Configure vector embedding model for structural code graph nodes.\n'
    + 'See https://github.com/tirth8205/code-review-graph#environment-variables',
  );

  const provider = await prompts.select(
    'crgEmbeddingProvider',
    'Select Code Review Graph embedding provider:',
    [
      { value: 'local', label: 'Local sentence-transformers (all-MiniLM-L6-v2, no API key)' },
      { value: 'openai', label: 'OpenAI / OpenAI-compatible (CRG_OPENAI_*)' },
      { value: 'voyage', label: 'Voyage AI (voyage-code-3)' },
      { value: 'google', label: 'Google Gemini' },
      { value: 'minimax', label: 'MiniMax' },
    ] as const,
    'local',
  );
  if (provider === null) return null;

  if (provider === 'local') {
    environment.CRG_EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
  } else if (provider === 'openai') {
    const key = await prompts.input('crgOpenaiApiKey', 'CRG_OPENAI_API_KEY (leave blank to reuse OPENAI_API_KEY)');
    if (key === null) return null;
    if (key.trim()) {
      environment.CRG_OPENAI_API_KEY = key.trim();
      envFileEntries.CRG_OPENAI_API_KEY = key.trim();
    }
    const baseUrl = await prompts.input('crgOpenaiBaseUrl', 'CRG_OPENAI_BASE_URL (optional endpoint, e.g. http://127.0.0.1:3000/v1)');
    if (baseUrl === null) return null;
    if (baseUrl.trim()) {
      environment.CRG_OPENAI_BASE_URL = baseUrl.trim();
      envFileEntries.CRG_OPENAI_BASE_URL = baseUrl.trim();
    }
    const model = await prompts.input('crgOpenaiModel', 'CRG_OPENAI_MODEL', 'text-embedding-3-small');
    if (model === null) return null;
    if (model.trim()) {
      environment.CRG_OPENAI_MODEL = model.trim();
      envFileEntries.CRG_OPENAI_MODEL = model.trim();
    }
    options.allowEgress = true;
  } else if (provider === 'voyage') {
    const key = await prompts.input('crgVoyageApiKey', 'VOYAGE_API_KEY (or CRG_VOYAGE_API_KEY)');
    if (key === null) return null;
    if (key.trim()) {
      environment.CRG_VOYAGE_API_KEY = key.trim();
      envFileEntries.CRG_VOYAGE_API_KEY = key.trim();
    }
    const model = await prompts.input('crgVoyageModel', 'CRG_VOYAGE_MODEL', 'voyage-code-3');
    if (model === null) return null;
    if (model.trim()) {
      environment.CRG_VOYAGE_MODEL = model.trim();
      envFileEntries.CRG_VOYAGE_MODEL = model.trim();
    }
    options.allowEgress = true;
  } else if (provider === 'google') {
    const key = await prompts.input('crgGoogleApiKey', 'GOOGLE_API_KEY (or CRG_GOOGLE_API_KEY)');
    if (key === null) return null;
    if (key.trim()) {
      environment.CRG_GOOGLE_API_KEY = key.trim();
      envFileEntries.CRG_GOOGLE_API_KEY = key.trim();
    }
    options.allowEgress = true;
  } else if (provider === 'minimax') {
    const key = await prompts.input('crgMinimaxApiKey', 'MINIMAX_API_KEY (or CRG_MINIMAX_API_KEY)');
    if (key === null) return null;
    if (key.trim()) {
      environment.CRG_MINIMAX_API_KEY = key.trim();
      envFileEntries.CRG_MINIMAX_API_KEY = key.trim();
    }
    options.allowEgress = true;
  }

  if (provider !== 'local') {
    environment.CRG_ACCEPT_CLOUD_EMBEDDINGS = '1';
    envFileEntries.CRG_ACCEPT_CLOUD_EMBEDDINGS = '1';
  }

  return {
    environment,
    envFileEntries,
    provider: provider === 'local' ? 'local (all-MiniLM-L6-v2)' : provider,
  };
}

interface ManagedEnvironmentResult {
  environment: Record<string, string>;
  envFileEntries: Record<string, string>;
  llmProvider: string;
  embeddingProvider: string;
  featuresSummary?: string | undefined;
}

async function collectManagedEnvironment(
  prompts: PromptAdapter,
  options: { allowEgress: boolean; allowLlm: boolean },
): Promise<ManagedEnvironmentResult | null> {
  const environment: Record<string, string> = {};
  const envFileEntries: Record<string, string> = {};

  const configureMemory = await prompts.confirm(
    'configureMemory',
    'Configure AgentMemory environment variables? (LLM keys, embeddings, features, tuning)',
    false,
  );
  if (configureMemory === null) return null;
  if (!configureMemory) {
    return {
      environment,
      envFileEntries,
      llmProvider: 'none (local fastembed)',
      embeddingProvider: 'default (local BM25 + fastembed)',
    };
  }

  prompts.notify(
    '### AgentMemory environment\n\n'
    + 'API keys are written to `.env` (never committed). '
    + 'Feature flags are persisted in `.mega-brain/config.json`.\n\n'
    + 'Leave blank to skip. See https://www.agent-memory.dev/docs/configuration',
  );

  const llmProvider = await prompts.select(
    'llmProvider',
    'Select LLM Provider (for summarization, graph extraction, observation compression):',
    [
      { value: 'none', label: 'None / Local only (BM25 + fastembed, zero external LLM)' },
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI (GPT)' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'minimax', label: 'MiniMax' },
      { value: 'ollama', label: 'Ollama (local / self-hosted)' },
    ] as const,
    'none',
  );
  if (llmProvider === null) return null;

  let hasLlm = false;
  if (llmProvider === 'anthropic') {
    const key = await prompts.input('anthropicApiKey', 'ANTHROPIC_API_KEY');
    if (key === null) return null;
    if (key.trim()) {
      envFileEntries.ANTHROPIC_API_KEY = key.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'anthropic';
      environment.AGENTMEMORY_PROVIDER = 'anthropic';
      hasLlm = true;
    }
  } else if (llmProvider === 'openai') {
    const key = await prompts.input('openaiApiKey', 'OPENAI_API_KEY');
    if (key === null) return null;
    if (key.trim()) {
      envFileEntries.OPENAI_API_KEY = key.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'openai';
      environment.AGENTMEMORY_PROVIDER = 'openai';
      hasLlm = true;
    }
  } else if (llmProvider === 'gemini') {
    const key = await prompts.input('geminiApiKey', 'GEMINI_API_KEY');
    if (key === null) return null;
    if (key.trim()) {
      envFileEntries.GEMINI_API_KEY = key.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'gemini';
      environment.AGENTMEMORY_PROVIDER = 'gemini';
      hasLlm = true;
    }
  } else if (llmProvider === 'openrouter') {
    const key = await prompts.input('openrouterApiKey', 'OPENROUTER_API_KEY');
    if (key === null) return null;
    if (key.trim()) {
      envFileEntries.OPENROUTER_API_KEY = key.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'openrouter';
      environment.AGENTMEMORY_PROVIDER = 'openrouter';
      hasLlm = true;
    }
  } else if (llmProvider === 'minimax') {
    const key = await prompts.input('minimaxApiKey', 'MINIMAX_API_KEY');
    if (key === null) return null;
    if (key.trim()) {
      envFileEntries.MINIMAX_API_KEY = key.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'minimax';
      environment.AGENTMEMORY_PROVIDER = 'minimax';
      hasLlm = true;
    }
  } else if (llmProvider === 'ollama') {
    const host = await prompts.input('ollamaHost', 'OLLAMA_HOST', 'http://localhost:11434');
    if (host === null) return null;
    if (host.trim()) {
      envFileEntries.OLLAMA_HOST = host.trim();
      envFileEntries.AGENTMEMORY_PROVIDER = 'ollama';
      environment.AGENTMEMORY_PROVIDER = 'ollama';
      hasLlm = true;
    }
  }

  const embeddingProviderChoice = await prompts.select(
    'embeddingProvider',
    'Select Embedding Provider for semantic search:',
    [
      { value: 'default', label: 'Default (same as LLM if supported, else local fastembed)' },
      { value: 'local', label: 'Local fastembed (all-MiniLM-L6-v2 + BM25, no API key)' },
      { value: 'openai', label: 'OpenAI (text-embedding-3-small)' },
      { value: 'voyage', label: 'Voyage AI (voyage-code-3 / voyage-3-lite)' },
      { value: 'cohere', label: 'Cohere (embed-english-v3.0)' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'ollama', label: 'Ollama' },
    ] as const,
    'default',
  );
  if (embeddingProviderChoice === null) return null;

  if (embeddingProviderChoice === 'openai' && !envFileEntries.OPENAI_API_KEY) {
    const key = await prompts.input('openaiApiKey', 'OPENAI_API_KEY (for embeddings)');
    if (key === null) return null;
    if (key.trim()) envFileEntries.OPENAI_API_KEY = key.trim();
  } else if (embeddingProviderChoice === 'voyage') {
    const key = await prompts.input('voyageApiKey', 'VOYAGE_API_KEY');
    if (key === null) return null;
    if (key.trim()) envFileEntries.VOYAGE_API_KEY = key.trim();
  } else if (embeddingProviderChoice === 'cohere') {
    const key = await prompts.input('cohereApiKey', 'COHERE_API_KEY');
    if (key === null) return null;
    if (key.trim()) envFileEntries.COHERE_API_KEY = key.trim();
  } else if (embeddingProviderChoice === 'gemini' && !envFileEntries.GEMINI_API_KEY) {
    const key = await prompts.input('geminiApiKey', 'GEMINI_API_KEY (for embeddings)');
    if (key === null) return null;
    if (key.trim()) envFileEntries.GEMINI_API_KEY = key.trim();
  } else if (embeddingProviderChoice === 'ollama' && !envFileEntries.OLLAMA_HOST) {
    const host = await prompts.input('ollamaHost', 'OLLAMA_HOST (for embeddings)', 'http://localhost:11434');
    if (host === null) return null;
    if (host.trim()) envFileEntries.OLLAMA_HOST = host.trim();
  }

  if (embeddingProviderChoice !== 'default') {
    environment.EMBEDDING_PROVIDER = embeddingProviderChoice;
    envFileEntries.EMBEDDING_PROVIDER = embeddingProviderChoice;
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
      envFileEntries.GRAPH_EXTRACTION_ENABLED = 'true';
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
      envFileEntries.CONSOLIDATION_ENABLED = 'true';
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
      envFileEntries.AGENTMEMORY_AUTO_COMPRESS = 'true';
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
      envFileEntries.AGENTMEMORY_REFLECT = 'true';
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
    envFileEntries.AGENTMEMORY_INJECT_CONTEXT = 'true';
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
    envFileEntries.SNAPSHOT_ENABLED = 'true';
    activeFeatures.push('snapshots');
  }

  const advancedMemory = await prompts.confirm(
    'advancedMemory',
    'Configure search tuning, runtime knobs, and bridges?',
    false,
  );
  if (advancedMemory === null) return null;
  if (advancedMemory) {
    const graphWeight = await prompts.input('graphWeight', 'Search graph weight (0.0 to 1.0)', '0.3');
    if (graphWeight === null) return null;
    if (graphWeight.trim() && graphWeight.trim() !== '0.3') {
      const parsed = Number(graphWeight.trim());
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        environment.AGENTMEMORY_GRAPH_WEIGHT = graphWeight.trim();
        envFileEntries.AGENTMEMORY_GRAPH_WEIGHT = graphWeight.trim();
      }
    }

    const dropStaleIndex = await prompts.confirm('dropStaleIndex', 'Drop stale vector indices on startup?', false);
    if (dropStaleIndex === null) return null;
    if (dropStaleIndex) {
      environment.AGENTMEMORY_DROP_STALE_INDEX = 'true';
      envFileEntries.AGENTMEMORY_DROP_STALE_INDEX = 'true';
    }

    const imageEmbeddings = await prompts.confirm('imageEmbeddings', 'Enable image embeddings for multimodal memories?', false);
    if (imageEmbeddings === null) return null;
    if (imageEmbeddings) {
      environment.AGENTMEMORY_IMAGE_EMBEDDINGS = 'true';
      envFileEntries.AGENTMEMORY_IMAGE_EMBEDDINGS = 'true';
    }

    const debugMode = await prompts.confirm('debugMode', 'Enable AgentMemory debug logging?', false);
    if (debugMode === null) return null;
    if (debugMode) {
      environment.AGENTMEMORY_DEBUG = 'true';
      envFileEntries.AGENTMEMORY_DEBUG = 'true';
    }

    const projectName = await prompts.input('projectName', 'Custom project namespace (AGENTMEMORY_PROJECT_NAME, leave blank for auto)', '');
    if (projectName === null) return null;
    if (projectName.trim()) {
      environment.AGENTMEMORY_PROJECT_NAME = projectName.trim();
      envFileEntries.AGENTMEMORY_PROJECT_NAME = projectName.trim();
    }

    const agentScope = await prompts.input('agentScope', 'Agent scope / role (AGENTMEMORY_AGENT_SCOPE, leave blank for default)', '');
    if (agentScope === null) return null;
    if (agentScope.trim()) {
      environment.AGENTMEMORY_AGENT_SCOPE = agentScope.trim();
      envFileEntries.AGENTMEMORY_AGENT_SCOPE = agentScope.trim();
    }

    const bridges = await prompts.confirm('bridges', 'Configure IDE editor bridges (Claude Code, Cursor, Windsurf, Cline)?', false);
    if (bridges === null) return null;
    if (bridges) {
      const claudeBridge = await prompts.confirm('claudeBridge', 'Enable Claude Code bridge?', false);
      if (claudeBridge) {
        environment.AGENTMEMORY_CLAUDE_CODE_BRIDGE = 'true';
        envFileEntries.AGENTMEMORY_CLAUDE_CODE_BRIDGE = 'true';
      }
      const cursorBridge = await prompts.confirm('cursorBridge', 'Enable Cursor bridge?', false);
      if (cursorBridge) {
        environment.AGENTMEMORY_CURSOR_BRIDGE = 'true';
        envFileEntries.AGENTMEMORY_CURSOR_BRIDGE = 'true';
      }
      const windsurfBridge = await prompts.confirm('windsurfBridge', 'Enable Windsurf bridge?', false);
      if (windsurfBridge) {
        environment.AGENTMEMORY_WINDSURF_BRIDGE = 'true';
        envFileEntries.AGENTMEMORY_WINDSURF_BRIDGE = 'true';
      }
      const clineBridge = await prompts.confirm('clineBridge', 'Enable Cline bridge?', false);
      if (clineBridge) {
        environment.AGENTMEMORY_CLINE_BRIDGE = 'true';
        envFileEntries.AGENTMEMORY_CLINE_BRIDGE = 'true';
      }
    }
  }

  const needsEgress = Object.keys(envFileEntries).some((key) =>
    /API_KEY$/u.test(key),
  ) || Object.keys(environment).some((key) =>
    ['GRAPH_EXTRACTION_ENABLED', 'CONSOLIDATION_ENABLED', 'AGENTMEMORY_AUTO_COMPRESS', 'AGENTMEMORY_REFLECT'].includes(key),
  ) || ['openai', 'voyage', 'cohere', 'gemini'].includes(embeddingProviderChoice);

  const needsLlm = hasLlm || Object.keys(environment).some((key) =>
    ['GRAPH_EXTRACTION_ENABLED', 'CONSOLIDATION_ENABLED', 'AGENTMEMORY_AUTO_COMPRESS', 'AGENTMEMORY_REFLECT'].includes(key),
  );

  if (needsEgress && !options.allowEgress) {
    options.allowEgress = true;
  }
  if (needsLlm && !options.allowLlm) {
    options.allowLlm = true;
    options.allowEgress = true;
  }

  return {
    environment,
    envFileEntries,
    llmProvider: hasLlm ? llmProvider : 'none (local fastembed)',
    embeddingProvider: embeddingProviderChoice === 'default' ? 'default (auto)' : embeddingProviderChoice,
    featuresSummary: activeFeatures.length > 0 ? activeFeatures.join(', ') : undefined,
  };
}

function parseDotEnvContent(raw: string): { lines: string[]; keys: Map<string, number> } {
  const lines = raw.split(/\r?\n/u);
  const keys = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line.trim());
    if (match?.[1]) keys.set(match[1], index);
  }
  return { lines, keys };
}

export async function mergeEnvFile(filePath: string, entries: Record<string, string>): Promise<void> {
  let raw = '';
  try { raw = await readFile(filePath, 'utf8'); } catch {}
  const { lines, keys } = parseDotEnvContent(raw);
  for (const [key, value] of Object.entries(entries)) {
    const existing = keys.get(key);
    if (existing !== undefined) {
      lines[existing] = `${key}=${value}`;
    } else {
      if (lines.length > 0 && lines[lines.length - 1]?.trim() !== '') lines.push('');
      lines.push(`${key}=${value}`);
    }
  }
  const final = lines.join('\n');
  await writeFile(filePath, final.endsWith('\n') ? final : `${final}\n`, 'utf8');
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

export async function runSetupWizard(dependencies: SetupDependencies): Promise<SetupResult> {
  const { prompts } = dependencies;
  if (!prompts.interactive) {
    throw new Error('mega-brain setup requires an interactive terminal');
  }

  await prompts.intro?.();

  let identity: ProjectIdentity;
  let preflight: InstallPreflightResult;
  let dependencyVersions!: ManagedDependencyVersions;
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
      break;
    } catch (error) {
      prompts.notify(`Preflight failed: ${errorMessage(error)}`);
    }
  }

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
    ] as const, 'managed');
    if (mode === null) return { status: 'cancelled' };
    if (mode === 'managed') {
      agentMemory = { mode: 'managed' };
      break;
    }
    const baseUrl = await prompts.input('remoteUrl', 'Remote AgentMemory URL');
    if (baseUrl === null) return { status: 'cancelled' };
    const authToken = await prompts.input('remoteAuthToken', 'Remote AgentMemory secret token');
    if (authToken === null) return { status: 'cancelled' };
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

  const advanced = await prompts.confirm('advanced', ' Configure advanced options?', false);
  if (advanced === null) return { status: 'cancelled' };
  let dataDir = path.resolve(dependencies.defaultDataDir);
  let crgCommand = 'code-review-graph';
  let codeReviewGraphMode: 'managed' | 'custom' = 'managed';
  let allowEgress = false;
  let allowLlm = false;
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
    prompts.notify(
      '### Network & Privacy\n\n'
      + '• **Network Egress**: Allows Mega Brain adapters to make outbound HTTPS calls to external LLM & embedding providers (OpenAI, Voyage, Google, Cohere, Anthropic, MiniMax).\n'
      + '• **If Disabled**: Mega Brain runs 100% offline/local-first using local fastembed/sentence-transformers and rejects external cloud API calls.',
    );
    allowEgress = await prompts.confirm('allowEgress', 'Allow network egress for external providers?', false) ?? false;
    allowLlm = allowEgress && (await prompts.confirm('allowLlm', 'Allow LLM providers?', false) ?? false);
  }

  let managedEnvResult: ManagedEnvironmentResult = {
    environment: {},
    envFileEntries: {},
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
    envFileEntries: {},
    provider: 'local (all-MiniLM-L6-v2)',
  };
  const crgMutableOpts = { allowEgress };
  const crgResult = await collectCrgEnvironment(prompts, crgMutableOpts);
  if (crgResult === null) return { status: 'cancelled' };
  crgEnvResult = crgResult;
  allowEgress = crgMutableOpts.allowEgress || allowEgress;

  const isolation = createRuntimeIsolation(runtimeLayout(dataDir, identity), identity.worktreeId);
  const config: ProjectConfig = {
    dataDir,
    port: 3000,
    logLevel: 'info',
    allowEgress,
    allowLlm,
    agentMemory: {
      mode: agentMemory.mode,
      baseUrl: agentMemory.mode === 'managed' ? `http://127.0.0.1:${isolation.ports.rest}` : agentMemory.baseUrl,
      ...(agentMemory.mode === 'remote' ? { authToken: agentMemory.authToken } : {}),
      ports: isolation.ports,
      environment: managedEnvResult.environment,
    },
    codeReviewGraph: { command: crgCommand, args: [], dataDir: isolation.paths.codeReviewGraph, environment: crgEnvResult.environment },
    projects: {},
  };
  const iiiEngineConfirmed = preflight.managedIiiEngineRequired && agentMemory.mode === 'managed'
    ? await prompts.confirm('iiiEngine', ` Download and verify iii-engine ${dependencyVersions.iiiEngine} inside this project runtime?`, true)
    : false;
  if (iiiEngineConfirmed === null) return { status: 'cancelled' };
  if (preflight.managedIiiEngineRequired && agentMemory.mode === 'managed' && !iiiEngineConfirmed) {
    prompts.notify('iii-engine confirmation is required for managed AgentMemory on Windows');
    return { status: 'cancelled' };
  }
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
  };
  prompts.notify(formatSetupSummary(summary));
  const confirmed = await prompts.confirm('confirm', 'Apply this setup?', true);
  if (!confirmed) return { status: 'cancelled' };

  const plan: SetupPlan = {
    identity,
    preflight,
    hosts: selectedHosts,
    codeReviewGraphMode,
    strictIsolation: true,
    config,
    iiiEngineConfirmed,
    dependencyVersions,
    summary,
    reopenHost: true,
    envFileEntries: { ...managedEnvResult.envFileEntries, ...crgEnvResult.envFileEntries },
  };
  try {
    await runSetupTask(prompts, 'Installing Mega Brain runtime, MCP files, and hooks', () => dependencies.install(plan));
    if (Object.keys(plan.envFileEntries).length > 0) {
      const writeEnv = dependencies.writeEnvFile ?? ((root, entries) => mergeEnvFile(path.join(root, '.env'), entries));
      await runSetupTask(prompts, 'Writing AgentMemory environment variables to .env', () => writeEnv(plan.identity.root, plan.envFileEntries));
    }
  } catch (error) {
    const failure = failureChecklist(plan, error);
    prompts.notify(formatChecklist('Setup failed', failure.items, failure.footer));
    throw error;
  }
  const success = successChecklist(plan);
  prompts.notify(formatChecklist('Setup complete', success.items, success.footer));
  return { status: 'installed', plan };
}
