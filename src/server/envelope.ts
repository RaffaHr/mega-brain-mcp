import { z } from 'zod';

export const freshnessSchema = z.enum([
  'FRESH',
  'POSSIBLY_STALE',
  'STALE',
  'CONFLICT',
  'DEPRECATED',
  'UNKNOWN',
]);

export const sourceSchema = z.object({
  kind: z.enum(['agentmemory', 'code_review_graph', 'git', 'mega_brain', 'provenance_lexical']),
  reference: z.string(),
  authority: z.number().min(0).max(1),
});

export const megaBrainEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0'),
  status: z.enum(['ok', 'degraded']),
  project: z.string().nullable(),
  head: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  freshness: freshnessSchema,
  sources: z.array(sourceSchema),
  warnings: z.array(z.string()),
  result: z.record(z.string(), z.unknown()),
});

export type MegaBrainEnvelope = z.infer<typeof megaBrainEnvelopeSchema>;

export function createEnvelope(
  result: Record<string, unknown>,
  overrides: Partial<Omit<MegaBrainEnvelope, 'schemaVersion' | 'result'>> = {},
): MegaBrainEnvelope {
  return megaBrainEnvelopeSchema.parse({
    schemaVersion: '1.0',
    status: 'ok',
    project: null,
    head: null,
    confidence: 0,
    freshness: 'UNKNOWN',
    sources: [],
    warnings: [],
    ...overrides,
    result,
  });
}
