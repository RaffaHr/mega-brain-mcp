import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { agentMemoryPortsSchema, logLevelSchema, tcpPortSchema } from './schema.js';
import type { MegaBrainConfig } from './schema.js';
import {
  loadConfigWithSources,
  redactConfig,
  type ConfigSource,
  type LoadConfigOptions,
} from './load.js';

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
  const required = ['.mega-brain/', '.env'];
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

export async function writeProjectConfig(repositoryRoot: string, input: ProjectConfigInput): Promise<string> {
  const config = projectConfigSchema.parse(input);
  await ensureGitIgnore(repositoryRoot);
  const target = projectConfigPath(repositoryRoot);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  if (process.platform !== 'win32') await chmod(target, 0o600);
  return target;
}
