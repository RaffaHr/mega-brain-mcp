import type { FreshnessState } from './freshness.js';

export type ValidationOutcome = 'confirmed' | 'refuted' | 'superseded';

export function stateAfterValidation(outcome: ValidationOutcome, hasCurrentConflict = false): FreshnessState {
  if (outcome === 'superseded') return 'DEPRECATED';
  if (outcome === 'refuted') return hasCurrentConflict ? 'CONFLICT' : 'STALE';
  return hasCurrentConflict ? 'CONFLICT' : 'FRESH';
}
