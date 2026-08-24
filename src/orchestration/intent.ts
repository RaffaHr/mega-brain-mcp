export const recallIntents = ['implementation', 'impact', 'history', 'decision', 'procedure', 'architecture', 'workflow', 'debugging'] as const;
export type RecallIntent = (typeof recallIntents)[number];

const patterns: Array<[RecallIntent, RegExp]> = [
  ['impact', /\b(?:break|impact|affect|blast radius|quebra|impacto|afeta)\b/i],
  ['history', /\b(?:history|previous|before|commit|hist[oó]ri|anterior|mudou)\b/i],
  ['decision', /\b(?:why|decision|chose|por que|decis[aã]o|escolh)\b/i],
  ['procedure', /\b(?:how do we|procedure|runbook|como corrig|procedimento)\b/i],
  ['architecture', /\b(?:architecture|component|boundary|arquitetura|componente)\b/i],
  ['workflow', /\b(?:flow|workflow|request path|fluxo)\b/i],
  ['debugging', /\b(?:bug|error|failure|debug|erro|falha)\b/i],
];

export function classifyIntent(query: string, explicit?: RecallIntent): RecallIntent {
  if (explicit) return explicit;
  return patterns.find(([, pattern]) => pattern.test(query))?.[0] ?? 'implementation';
}
