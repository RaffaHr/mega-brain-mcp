import type { RecallIntent } from './intent.js';

export type RecallSource = 'agentmemory' | 'code_review_graph' | 'git';

const routes: Record<RecallIntent, readonly RecallSource[]> = {
  implementation: ['code_review_graph', 'git', 'agentmemory'],
  impact: ['code_review_graph', 'git', 'agentmemory'],
  history: ['agentmemory', 'git', 'code_review_graph'],
  decision: ['agentmemory', 'git', 'code_review_graph'],
  procedure: ['agentmemory', 'git', 'code_review_graph'],
  architecture: ['code_review_graph', 'agentmemory', 'git'],
  workflow: ['code_review_graph', 'agentmemory', 'git'],
  debugging: ['agentmemory', 'code_review_graph', 'git'],
};

export function routeRecall(intent: RecallIntent): readonly RecallSource[] {
  return routes[intent];
}
