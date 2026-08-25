import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const capabilityContractSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  mutating: z.boolean(),
  inputSchema: jsonObjectSchema,
  outputSchema: jsonObjectSchema,
  schemaHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const compatibilityManifestSchema = z.object({
  backend: z.enum(['agentmemory', 'code-review-graph']),
  distribution: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  transport: z.enum(['rest', 'stdio']),
  protocol: z.enum(['http-json', 'mcp']),
  allowAdditionalCapabilities: z.boolean(),
  isolation: z.object({
    namespaceField: z.string().min(1).optional(),
    requiredEnvironment: z.array(z.string().min(1)).optional(),
  }).optional(),
  capabilities: z.array(capabilityContractSchema).min(1),
  contractHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export type CapabilityContract = z.infer<typeof capabilityContractSchema>;
export type CompatibilityManifest = z.infer<typeof compatibilityManifestSchema>;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

export function capabilitySchemaHash(
  capability: Pick<CapabilityContract, 'inputSchema' | 'outputSchema'>,
): string {
  return sha256({ inputSchema: capability.inputSchema, outputSchema: capability.outputSchema });
}

export function manifestContractHash(manifest: Omit<CompatibilityManifest, 'contractHash'>): string {
  return sha256(manifest);
}

export function assertManifestIntegrity(manifest: CompatibilityManifest): CompatibilityManifest {
  for (const capability of manifest.capabilities) {
    if (capability.schemaHash !== capabilitySchemaHash(capability)) {
      throw new Error(`Compatibility fixture has a stale schema hash: ${capability.name}`);
    }
  }
  const { contractHash, ...contract } = manifest;
  if (contractHash !== manifestContractHash(contract)) {
    throw new Error(`Compatibility fixture has a stale contract hash: ${manifest.backend}@${manifest.version}`);
  }
  return manifest;
}

export async function loadCompatibilityManifest(filePath: string): Promise<CompatibilityManifest> {
  const parsed = compatibilityManifestSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  return assertManifestIntegrity(parsed);
}
