import { z } from 'zod';

export const managedDependencyVersionSchema = z.string()
  .min(1)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u, 'Version must be an exact semver value');

export const DEFAULT_MANAGED_DEPENDENCY_VERSIONS = {
  agentMemory: '0.9.29',
  codeReviewGraph: '2.3.8',
  iiiEngine: '0.11.2',
} as const;

export const managedDependencyVersionsSchema = z.object({
  agentMemory: managedDependencyVersionSchema,
  codeReviewGraph: managedDependencyVersionSchema,
  iiiEngine: managedDependencyVersionSchema,
});

export const MANAGED_DEPENDENCY_VERSION_ENV = {
  agentMemory: 'MEGA_BRAIN_AGENTMEMORY_VERSION',
  codeReviewGraph: 'MEGA_BRAIN_CODE_REVIEW_GRAPH_VERSION',
  iiiEngine: 'MEGA_BRAIN_III_ENGINE_VERSION',
} as const;

export const LEGACY_III_ENGINE_VERSION_ENV = 'AGENTMEMORY_III_VERSION';

export type ManagedDependencyVersions = z.infer<typeof managedDependencyVersionsSchema>;

export function parseManagedDependencyVersion(value: string, variable: string): string {
  const parsed = managedDependencyVersionSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${variable} must be an exact semver version`);
  return parsed.data;
}