import type { CompatibilityManifest } from './manifest.js';

export interface ObservedCapability {
  name: string;
  schemaHash: string;
}

export interface BackendObservation {
  distribution: string;
  version: string;
  protocol: string;
  capabilities: ObservedCapability[];
}

export interface CompatibilityResult {
  compatible: boolean;
  missing: string[];
  unexpected: string[];
  schemaMismatches: string[];
}

export class CompatibilityError extends Error {
  constructor(readonly result: CompatibilityResult, message: string) {
    super(message);
    this.name = 'CompatibilityError';
  }
}

export function negotiateCompatibility(
  manifest: CompatibilityManifest,
  observation: BackendObservation,
): CompatibilityResult {
  if (
    observation.distribution !== manifest.distribution ||
    observation.version !== manifest.version ||
    observation.protocol !== manifest.protocol
  ) {
    throw new CompatibilityError(
      { compatible: false, missing: [], unexpected: [], schemaMismatches: [] },
      `Unsupported backend contract for ${manifest.backend}`,
    );
  }

  const observedByName = new Map(observation.capabilities.map((capability) => [capability.name, capability]));
  const acceptedNames = new Set<string>();
  const missing: string[] = [];
  const schemaMismatches: string[] = [];

  for (const expected of manifest.capabilities) {
    const candidateNames = [expected.name, ...(expected.aliases ?? [])];
    const observed = candidateNames.map((name) => observedByName.get(name)).find(Boolean);
    if (!observed) {
      missing.push(expected.name);
      continue;
    }
    acceptedNames.add(observed.name);
    if (observed.schemaHash !== expected.schemaHash) schemaMismatches.push(expected.name);
  }

  const unexpected = manifest.allowAdditionalCapabilities
    ? []
    : observation.capabilities
        .filter(({ name }) => !acceptedNames.has(name))
        .map(({ name }) => name)
        .sort();
  const result = {
    compatible: missing.length === 0 && unexpected.length === 0 && schemaMismatches.length === 0,
    missing: missing.sort(),
    unexpected,
    schemaMismatches: schemaMismatches.sort(),
  };
  if (!result.compatible) throw new CompatibilityError(result, `Incompatible capabilities for ${manifest.backend}`);
  return result;
}
