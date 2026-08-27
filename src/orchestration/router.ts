import type { RecallIntent } from './intent.js';

export type RecallSource = 'agentmemory' | 'code_review_graph' | 'git' | 'provenance_lexical';

const routes: Record<RecallIntent, readonly RecallSource[]> = {
  implementation: ['code_review_graph', 'git', 'agentmemory', 'provenance_lexical'],
  impact: ['code_review_graph', 'git', 'agentmemory', 'provenance_lexical'],
  history: ['agentmemory', 'git', 'code_review_graph', 'provenance_lexical'],
  decision: ['agentmemory', 'git', 'code_review_graph', 'provenance_lexical'],
  procedure: ['agentmemory', 'git', 'code_review_graph', 'provenance_lexical'],
  architecture: ['code_review_graph', 'agentmemory', 'git', 'provenance_lexical'],
  workflow: ['code_review_graph', 'agentmemory', 'git', 'provenance_lexical'],
  debugging: ['agentmemory', 'code_review_graph', 'git', 'provenance_lexical'],
};

export function routeRecall(intent: RecallIntent): readonly RecallSource[] {
  return routes[intent];
}
