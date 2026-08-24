export const knowledgeTypes = ['fact', 'decision', 'architecture', 'procedure', 'bug', 'rule', 'preference', 'experience'] as const;
export type KnowledgeType = (typeof knowledgeTypes)[number];
export type KnowledgeAuthority = 'verified' | 'experiential' | 'unverified';

export interface EvidenceInput {
  path: string;
  blobHash?: string;
  commitHash?: string;
  symbol?: string;
}

export function authorityForEvidence(evidence: EvidenceInput[]): { authority: KnowledgeAuthority; confidence: number } {
  if (evidence.some(({ blobHash, commitHash }) => Boolean(blobHash && commitHash))) return { authority: 'verified', confidence: 1 };
  if (evidence.length > 0) return { authority: 'experiential', confidence: 0.55 };
  return { authority: 'unverified', confidence: 0.3 };
}
