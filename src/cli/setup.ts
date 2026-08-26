import path from 'node:path';

import type { ProjectConfig } from '../config/project-config.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { createRuntimeIsolation } from '../runtime/lock-manifest.js';
import { runtimeLayout } from '../runtime/layout.js';
import { promptForHosts } from './host-selection.js';
import type { InstallPreflightResult } from './preflight.js';
import type { PromptAdapter } from './prompts.js';

export type SetupHost = 'codex' | 'claude';

export interface SetupPlan {
  identity: ProjectIdentity;
  preflight: InstallPreflightResult;
  hosts: SetupHost[];
  codeReviewGraphMode: 'managed' | 'custom';
  strictIsolation: true;
  config: ProjectConfig;
  iiiEngineConfirmed: boolean;
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
  probeRemote(input: { baseUrl: string; secret: string; identity: ProjectIdentity }): Promise<unknown>;
  install(plan: SetupPlan): Promise<void>;
}

export type SetupResult = { status: 'cancelled' } | { status: 'installed'; plan: SetupPlan };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSetupWizard(dependencies: SetupDependencies): Promise<SetupResult> {
  const { prompts } = dependencies;
  if (!prompts.interactive) {
    throw new Error('mega-brain setup requires an interactive terminal; use mega-brain install for CI or non-interactive automation');
  }

  let identity: ProjectIdentity;
  let preflight: InstallPreflightResult;
  while (true) {
    const repository = await prompts.input('repository', 'Repository directory', dependencies.currentDirectory);
    if (repository === null) return { status: 'cancelled' };
    const resolved = path.resolve(repository);
    try {
      prompts.notify(`Checking prerequisites for ${resolved}`);
      preflight = await dependencies.preflight(resolved);
      prompts.notify('Detecting project identity');
      identity = await dependencies.discoverIdentity(resolved);
      if (!identity.gitBacked) prompts.notify('No Git repository found; Git hooks and Git-backed evidence will be skipped until this directory is initialized as a repository.');
      prompts.notify(`Preflight: Node ${preflight.nodeVersion}; Python ${preflight.pythonVersion}; Git ${preflight.gitVersion}; ${preflight.platform}`);
      break;
    } catch (error) {
      prompts.notify(`Preflight failed: ${errorMessage(error)}`);
    }
  }

  const selectedHosts = await promptForHosts(prompts);
  if (selectedHosts === null) return { status: 'cancelled' };

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
      await dependencies.probeRemote({ baseUrl, secret: authToken, identity });
      agentMemory = { mode: 'remote', baseUrl, authToken };
      break;
    } catch (error) {
      prompts.notify(`Remote validation failed: ${errorMessage(error)}. Try again or choose managed.`);
    }
  }

  const advanced = await prompts.confirm('advanced', 'Configure advanced options?', false);
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
    allowEgress = await prompts.confirm('allowEgress', 'Allow network egress?', false) ?? false;
    allowLlm = allowEgress && (await prompts.confirm('allowLlm', 'Allow LLM providers?', false) ?? false);
  }

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
      environment: {},
    },
    codeReviewGraph: { command: crgCommand, args: [], dataDir: isolation.paths.codeReviewGraph, environment: {} },
    projects: {},
  };
  const iiiEngineConfirmed = preflight.managedIiiEngineRequired && agentMemory.mode === 'managed'
    ? await prompts.confirm('iiiEngine', 'Download and verify iii-engine 0.11.2 inside this project runtime?', true)
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
    codeReviewGraph: crgCommand === 'code-review-graph' ? 'managed' : 'custom',
    dataDir,
    strictIsolation: true,
    allowEgress,
    allowLlm,
  };
  prompts.notify(`Summary:\n${JSON.stringify(summary, null, 2)}`);
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
    summary,
    reopenHost: true,
  };
  prompts.notify('Installing Mega Brain runtime, MCP files, and hooks');
  await dependencies.install(plan);
  return { status: 'installed', plan };
}
