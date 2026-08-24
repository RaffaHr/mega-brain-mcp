import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const runtimeCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  lifecycle: z.enum(['daemon', 'on-demand']),
});

export const agentMemoryModeSchema = z.enum(['managed', 'remote']);

export const runtimeLockManifestSchema = z.object({
  schemaVersion: z.literal(1),
  installedAt: z.iso.datetime(),
  agentMemoryMode: agentMemoryModeSchema.default('managed'),
  project: z.object({ repositoryId: z.string(), checkoutId: z.string(), worktreeId: z.string() }),
  versions: z.object({
    megaBrain: z.string(),
    agentMemory: z.literal('0.9.29'),
    codeReviewGraph: z.literal('2.3.7'),
  }),
  backends: z.object({
    agentMemory: runtimeCommandSchema.optional(),
    codeReviewGraph: runtimeCommandSchema,
  }),
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
