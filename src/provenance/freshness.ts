export type FreshnessState = 'FRESH' | 'POSSIBLY_STALE' | 'STALE' | 'CONFLICT' | 'DEPRECATED' | 'UNKNOWN';

export interface EvidenceSnapshot {
  path: string;
  storedHash: string;
  currentHash: string | null;
  inBlastRadius?: boolean;
  workingTreeChanged?: boolean;
}

export interface FreshnessAssessment {
  state: FreshnessState;
  confidence: number;
  reasons: string[];
}

export function assessFreshness(input: {
  evidence: EvidenceSnapshot[];
  conflict?: boolean;
  supersededBy?: string;
}): FreshnessAssessment {
  if (input.supersededBy) return { state: 'DEPRECATED', confidence: 0, reasons: [`superseded_by:${input.supersededBy}`] };
  if (input.conflict) return { state: 'CONFLICT', confidence: 0.2, reasons: ['current_evidence_conflicts'] };
  if (input.evidence.length === 0) return { state: 'UNKNOWN', confidence: 0.25, reasons: ['no_verifiable_evidence'] };
  if (input.evidence.some(({ currentHash }) => currentHash === null)) {
    return { state: 'STALE', confidence: 0, reasons: ['evidence_removed'] };
  }
  const reasons = new Set<string>();
  for (const evidence of input.evidence) {
    if (evidence.currentHash !== evidence.storedHash) reasons.add('evidence_changed');
    if (evidence.inBlastRadius) reasons.add('related_symbol_changed');
    if (evidence.workingTreeChanged) reasons.add('relevant_worktree_change');
  }
  if (reasons.size > 0) return { state: 'POSSIBLY_STALE', confidence: 0.45, reasons: [...reasons].sort() };
  return { state: 'FRESH', confidence: 1, reasons: ['all_evidence_hashes_match'] };
}
