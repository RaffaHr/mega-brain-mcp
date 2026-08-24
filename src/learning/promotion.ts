import type { KnowledgeAuthority } from './taxonomy.js';

export function promoteAuthority(current: KnowledgeAuthority, verifiedEvidenceCount: number): KnowledgeAuthority {
  if (verifiedEvidenceCount > 0) return 'verified';
  if (current === 'unverified') return 'experiential';
  return current;
}
