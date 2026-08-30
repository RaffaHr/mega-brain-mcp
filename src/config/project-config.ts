import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import {
  agentMemoryPortsSchema,
  configurationSourceSchema,
  configurationStatusSchema,
  logLevelSchema,
  projectConfigMetadataSchema,
  tcpPortSchema,
} from './schema.js';
import type { MegaBrainConfig, ProjectConfigMetadata } from './schema.js';
import { BACKEND_ENVIRONMENT_CATALOG_BY_KEY, type EnvironmentConsumer } from './backend-environment-catalog.js';

import {
  loadConfigWithSources,
  redactConfig,
  type ConfigSource,
  type LoadConfigOptions,
} from './load.js';

const execFileAsync = promisify(execFile);

export interface ResolvedProjectConfig {
  config: Readonly<MegaBrainConfig>;
  sources: Readonly<Record<string, ConfigSource>>;
  diagnostic: Readonly<{
    config: Readonly<Record<string, unknown>>;
    sources: Readonly<Record<string, ConfigSource>>;
  }>;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export async function resolveProjectConfig(options: LoadConfigOptions = {}): Promise<ResolvedProjectConfig> {
  const loaded = await loadConfigWithSources(options);
  const sources = deepFreeze({ ...loaded.sources });
  const config = deepFreeze(loaded.config);
  const diagnostic = deepFreeze({ config: redactConfig(loaded.config), sources });
  return deepFreeze({ config, sources, diagnostic });
}

export const backendEnvironmentSchema = z.record(z.string(), z.string());

export const projectConfigSchema = z.object({
  dataDir: z.string().min(1),
  port: tcpPortSchema.default(3000),
  logLevel: logLevelSchema.default('info'),
  allowEgress: z.boolean().default(false),
  allowLlm: z.boolean().default(false),
  agentMemory: z.object({
    mode: z.enum(['managed', 'remote']),
    baseUrl: z.url(),
    authToken: z.string().min(1).optional(),
    ports: agentMemoryPortsSchema,
    environment: backendEnvironmentSchema.default({}),
  }).superRefine((agentMemory, context) => {
    if (agentMemory.mode === 'remote' && !agentMemory.authToken) {
      context.addIssue({ code: 'custom', path: ['authToken'], message: 'Remote mode requires a repository-local AgentMemory token' });
    }
    if (agentMemory.mode === 'managed' && agentMemory.authToken) {
      context.addIssue({ code: 'custom', path: ['authToken'], message: 'Managed mode must not retain remote secret configuration' });
    }
  }),
  codeReviewGraph: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    dataDir: z.string().min(1).optional(),
    environment: backendEnvironmentSchema.default({}),
  }),
  projects: z.record(z.string(), z.string()).default({}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfigInput = z.input<typeof projectConfigSchema>;

export const projectConfigDocumentSchema = z.object({
  effective: projectConfigSchema,
  sources: z.record(z.string(), configurationSourceSchema).default({}),
  status: z.record(z.string(), configurationStatusSchema).default({}),
  consents: projectConfigMetadataSchema.shape.consents,
});
export type ProjectConfigDocument = z.infer<typeof projectConfigDocumentSchema>;

export function projectConfigPath(repositoryRoot: string): string {
  return path.join(path.resolve(repositoryRoot), '.mega-brain', 'config.json');
}

export async function ensureGitIgnore(repositoryRoot: string): Promise<string> {
  const gitignorePath = path.join(path.resolve(repositoryRoot), '.gitignore');
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lines = current.split(/\r?\n/u).map((line) => line.trim());
  const required = ['.mega-brain/'];
  const additions: string[] = [];
  for (const entry of required) {
    if (!lines.includes(entry) && !lines.includes(entry.replace(/\/$/u, ''))) {
      additions.push(entry);
    }
  }
  if (additions.length > 0) {
    const trailingNewline = current.length === 0 || current.endsWith('\n') || current.endsWith('\r\n');
    const prefix = trailingNewline ? '' : '\n';
    const content = `${current}${prefix}${additions.join('\n')}\n`;
    await writeFile(gitignorePath, content, 'utf8');
  }
  return gitignorePath;
}

export async function assertProjectConfigUntracked(repositoryRoot: string): Promise<void> {
  try {
    const result = await execFileAsync('git', ['-C', path.resolve(repositoryRoot), 'ls-files', '--', '.mega-brain']);
    if (result.stdout.trim()) {
      throw new Error('`.mega-brain/` is already tracked by Git. Remove it from the index manually with `git rm --cached -r -- .mega-brain`, then rerun setup.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already tracked')) throw error;
    const details = error instanceof Error
      ? `${error.message}\n${String((error as NodeJS.ErrnoException & { stderr?: unknown }).stderr ?? '')}`
      : String(error);
    if (/not a git repository/iu.test(details)) return;
    throw new Error(`Unable to verify whether .mega-brain is tracked by Git: ${details.trim()}`);
  }
}

async function restrictProjectConfigDirectory(directory: string): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700);
    return undefined;
  }
  const principal = (await execFileAsync('whoami', [], { windowsHide: true })).stdout.toString().trim();
  if (!principal) throw new Error('Unable to identify current Windows user for local config ACL');
  await execFileAsync('icacls', [
    directory,
    '/inheritance:r',
    '/grant:r',
    `${principal}:(OI)(CI)F`,
    '/T',
    '/C',
  ], { windowsHide: true });
  return principal;
}

async function restrictProjectConfigFile(target: string, windowsPrincipal?: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(target, 0o600);
    return;
  }
  if (!windowsPrincipal) throw new Error('Windows principal is required for local config ACL');
  await execFileAsync('icacls', [
    target,
    '/inheritance:r',
    '/grant:r',
    `${windowsPrincipal}:F`,
  ], { windowsHide: true });
}

function validatePersistedBackendEnvironment(consumer: EnvironmentConsumer, environment: Record<string, string>): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    const entry = BACKEND_ENVIRONMENT_CATALOG_BY_KEY.get(key);
    if (!entry || !entry.forwarded || !entry.consumers.includes(consumer)) {
      throw new Error(`Environment variable ${key} is not an effective ${consumer} setting`);
    }
    if (!value.trim()) throw new Error(`Environment variable ${key} cannot be empty in persisted configuration`);
    validated[key] = value;
  }
  return validated;
}

export async function writeProjectConfig(
  repositoryRoot: string,
  input: ProjectConfigInput,
  metadata: Partial<ProjectConfigMetadata> = {},
): Promise<string> {
  const rawInput = input as ProjectConfigInput;
  const config = projectConfigSchema.parse({
    ...rawInput,
    agentMemory: {
      ...rawInput.agentMemory,
      environment: validatePersistedBackendEnvironment('agentMemory', rawInput.agentMemory?.environment ?? {}),
    },
    codeReviewGraph: {
      ...rawInput.codeReviewGraph,
      environment: validatePersistedBackendEnvironment('codeReviewGraph', rawInput.codeReviewGraph?.environment ?? {}),
    },
  });
  const document = projectConfigDocumentSchema.parse({
    effective: config,
    sources: metadata.sources ?? {},
    status: metadata.status ?? {},
    consents: metadata.consents ?? {},
  });
  await ensureGitIgnore(repositoryRoot);
  await assertProjectConfigUntracked(repositoryRoot);
  const target = projectConfigPath(repositoryRoot);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const windowsPrincipal = await restrictProjectConfigDirectory(directory);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  await restrictProjectConfigFile(target, windowsPrincipal);
  return target;
}
