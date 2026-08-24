import type { FreshnessAssessment } from '../provenance/freshness.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface ValidationStore {
  assess(memoryId: string): Promise<FreshnessAssessment>;
  record(memoryId: string, assessment: FreshnessAssessment): Promise<void>;
}

export async function brainValidate(input: {
  project: string;
  head: string;
  memoryIds: string[];
}, store: ValidationStore): Promise<MegaBrainEnvelope> {
  const validations = [];
  for (const memoryId of input.memoryIds) {
    const assessment = await store.assess(memoryId);
    await store.record(memoryId, assessment);
    validations.push({ memoryId, ...assessment });
  }
  const stale = validations.some(({ state }) => state !== 'FRESH');
  return createEnvelope({ validations, contentUpdated: false }, {
    project: input.project, head: input.head, confidence: stale ? 0.5 : 1,
    freshness: stale ? 'POSSIBLY_STALE' : 'FRESH', warnings: [],
    sources: [{ kind: 'mega_brain', reference: 'validation-metadata', authority: 1 }],
  });
}
