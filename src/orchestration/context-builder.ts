import { rankEvidenceChunks, type EvidenceChunk } from './ranking.js';

export const TOKEN_BUDGETS = { FAST: 500, NORMAL: 1200, DEEP: 2500 } as const;
export type RecallBudget = keyof typeof TOKEN_BUDGETS;

export interface ContextPack {
  text: string;
  chunks: EvidenceChunk[];
  estimatedTokens: number;
  budget: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function buildContextPack(chunks: EvidenceChunk[], budgetName: RecallBudget, ceiling = 2500): ContextPack {
  const budget = Math.min(TOKEN_BUDGETS[budgetName], ceiling);
  const selected: EvidenceChunk[] = [];
  const sections: string[] = [];
  let used = 0;
  for (const chunk of rankEvidenceChunks(chunks)) {
    const prefix = `[${chunk.source}] ${chunk.reference}\n`;
    const prefixTokens = estimateTokens(prefix);
    const remaining = budget - used - prefixTokens;
    if (remaining <= 0) break;
    const text = estimateTokens(chunk.text) <= remaining ? chunk.text : chunk.text.slice(0, remaining * 4);
    if (!text) continue;
    const section = `${prefix}${text}`;
    const tokens = estimateTokens(section);
    if (used + tokens > budget) continue;
    selected.push({ ...chunk, text });
    sections.push(section);
    used += tokens;
  }
  return { text: sections.join('\n\n'), chunks: selected, estimatedTokens: used, budget };
}
