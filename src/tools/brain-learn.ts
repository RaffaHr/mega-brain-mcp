import { classifyRelationship } from '../learning/deduplication.js';
import { authorityForEvidence, type EvidenceInput, type KnowledgeType } from '../learning/taxonomy.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';
import { redactText, redactValue } from '../security/redaction.js';

export const redactLearningContent = redactText;

export interface ExistingKnowledge {
  id: string;
  statement: string;
  negated?: boolean;
}

export interface LearningStore {
  findEquivalent(statement: string): Promise<ExistingKnowledge | undefined>;
  save(input: Record<string, unknown>): Promise<{ id: string }>;
  reinforce(id: string, evidence: EvidenceInput[]): Promise<void>;
  recordConflict(existingId: string, replacementId: string): Promise<void>;
  supersede(existingId: string, replacementId: string): Promise<void>;
}

export async function brainLearn(input: {
  project: string;
  head: string;
  statement: string;
  type: KnowledgeType;
  evidence?: EvidenceInput[];
  supersedes?: string;
}, store: LearningStore): Promise<MegaBrainEnvelope> {
  const statement = redactLearningContent(input.statement);
  const evidence = redactValue(input.evidence ?? []) as EvidenceInput[];
  const trust = authorityForEvidence(evidence);
  const existing = await store.findEquivalent(statement);
  const relationship = classifyRelationship({
    statement,
    ...(existing ? { existing } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
  });
  if ((relationship === 'equivalent' || relationship === 'reinforcement') && existing) {
    await store.reinforce(existing.id, evidence);
    return createEnvelope({ memoryId: existing.id, action: 'reinforced', authority: trust.authority }, {
      project: input.project, head: input.head, confidence: trust.confidence, freshness: 'FRESH',
      sources: [{ kind: 'agentmemory', reference: existing.id, authority: trust.confidence }], warnings: [],
    });
  }
  const saved = await store.save({ statement, type: input.type, evidence, authority: trust.authority, confidence: trust.confidence });
  if (relationship === 'conflict' && existing) await store.recordConflict(existing.id, saved.id);
  if (relationship === 'supersession' && input.supersedes) await store.supersede(input.supersedes, saved.id);
  return createEnvelope({ memoryId: saved.id, action: relationship, authority: trust.authority }, {
    project: input.project, head: input.head, confidence: trust.confidence,
    freshness: relationship === 'conflict' ? 'CONFLICT' : 'FRESH',
    sources: [{ kind: 'agentmemory', reference: saved.id, authority: trust.confidence }],
    warnings: trust.authority === 'unverified' ? ['knowledge stored as unverified'] : [],
  });
}
