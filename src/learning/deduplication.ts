import { createHash } from 'node:crypto';

export function normalizeKnowledge(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function knowledgeFingerprint(value: string): string {
  return createHash('sha256').update(normalizeKnowledge(value)).digest('hex');
}

export type KnowledgeRelationship = 'new' | 'equivalent' | 'reinforcement' | 'conflict' | 'supersession';

export function classifyRelationship(input: {
  statement: string;
  existing?: { statement: string; negated?: boolean };
  supersedes?: string;
}): KnowledgeRelationship {
  if (input.supersedes) return 'supersession';
  if (!input.existing) return 'new';
  if (knowledgeFingerprint(input.statement) === knowledgeFingerprint(input.existing.statement)) return 'equivalent';
  if (input.existing.negated || /^not\b|\bn[aã]o\b/i.test(input.statement)) return 'conflict';
  return 'reinforcement';
}
