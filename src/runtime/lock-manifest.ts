import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { managedDependencyVersionSchema } from './dependency-versions.js';

export const runtimeCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  lifecycle: z.enum(['daemon', 'on-demand']),
  environment: z.record(z.string(), z.string()).optional(),
  prependPath: z.string().refine(path.isAbsolute).optional(),
});

export const agentMemoryModeSchema = z.enum(['managed', 'remote']);

export const runtimeIsolationSchema = z.object({
  worktreeId: z.string().regex(/^[a-f0-9]{24}$/u),
  ports: z.object({
    rest: z.number().int().min(1).max(65_535),
    streams: z.number().int().min(1).max(65_535),
    viewer: z.number().int().min(1).max(65_535),
    engine: z.number().int().min(1).max(65_535),
  }),
  paths: z.object({
    agentMemory: z.string().refine(path.isAbsolute),
    iiiEngine: z.string().refine(path.isAbsolute),
    codeReviewGraph: z.string().refine(path.isAbsolute),
    provenance: z.string().refine(path.isAbsolute),
  }),
}).superRefine((isolation, context) => {
  if (new Set(Object.values(isolation.ports)).size !== 4) {
    context.addIssue({ code: 'custom', path: ['ports'], message: 'Backend ports must be unique' });
  }
});

export type RuntimeIsolation = z.infer<typeof runtimeIsolationSchema>;

export function createRuntimeIsolation(layout: { projectRoot: string }, worktreeId: string): RuntimeIsolation {
  if (!/^[a-f0-9]{24}$/u.test(worktreeId)) throw new Error('Invalid worktree identity for runtime isolation');
  const hash = Number.parseInt(worktreeId.slice(0, 8), 16);
  const rest = 10_000 + (hash % 8_000);
  return runtimeIsolationSchema.parse({
    worktreeId,
    ports: { rest, streams: rest + 1, viewer: rest + 2, engine: rest + 46_023 },
    paths: {
      agentMemory: path.resolve(layout.projectRoot, 'agentmemory-data'),
      iiiEngine: path.resolve(layout.projectRoot, 'iii-engine'),
      codeReviewGraph: path.resolve(layout.projectRoot, 'code-review-graph-data'),
      provenance: path.resolve(layout.projectRoot, 'provenance.sqlite'),
    },
  });
}

export const runtimeLockManifestSchema = z.object({
  schemaVersion: z.literal(1),
  installedAt: z.iso.datetime(),
  agentMemoryMode: agentMemoryModeSchema.default('managed'),
  project: z.object({ repositoryId: z.string(), checkoutId: z.string(), worktreeId: z.string() }),
  versions: z.object({
    megaBrain: z.string(),
    agentMemory: managedDependencyVersionSchema,
    codeReviewGraph: managedDependencyVersionSchema,
    iiiEngine: managedDependencyVersionSchema.optional(),
  }),
  backends: z.object({
    agentMemory: runtimeCommandSchema.optional(),
    codeReviewGraph: runtimeCommandSchema,
  }),
  isolation: runtimeIsolationSchema.optional(),
  remoteAgentMemory: z.object({
    baseUrl: z.url(),
  }).optional(),
}).superRefine((manifest, context) => {
  if (manifest.agentMemoryMode === 'managed' && !manifest.backends.agentMemory) {
    context.addIssue({
      code: 'custom',
      path: ['backends', 'agentMemory'],
      message: 'Managed AgentMemory mode requires a local backend command',
    });
  }
  if (manifest.agentMemoryMode === 'remote' && manifest.backends.agentMemory) {
    context.addIssue({
      code: 'custom',
      path: ['backends', 'agentMemory'],
      message: 'Remote AgentMemory mode must not persist a local backend command',
    });
  }
  if (manifest.agentMemoryMode === 'remote' && !manifest.remoteAgentMemory) {
    context.addIssue({
      code: 'custom',
      path: ['remoteAgentMemory'],
      message: 'Remote AgentMemory mode requires only its URL in the runtime manifest',
    });
  }
  if (manifest.agentMemoryMode === 'managed' && manifest.remoteAgentMemory) {
    context.addIssue({
      code: 'custom',
      path: ['remoteAgentMemory'],
      message: 'Managed AgentMemory mode must not persist remote connection configuration',
    });
  }
});

export type RuntimeLockManifest = z.infer<typeof runtimeLockManifestSchema>;

export async function writeRuntimeLock(filePath: string, manifest: RuntimeLockManifest): Promise<void> {
  const parsed = runtimeLockManifestSchema.parse(manifest);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, filePath);
}

export async function readRuntimeLock(filePath: string): Promise<RuntimeLockManifest> {
  return runtimeLockManifestSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
}
