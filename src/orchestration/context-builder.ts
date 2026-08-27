import { normalizeKnowledge } from '../learning/deduplication.js';
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

export function deduplicateEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
  const seen = new Map<string, EvidenceChunk>();
  for (const chunk of chunks) {
    const key = normalizeKnowledge(chunk.text);
    const existing = seen.get(key);
    if (!existing || chunk.confidence > existing.confidence || (chunk.confidence === existing.confidence && chunk.freshness > existing.freshness)) {
      seen.set(key, chunk);
    }
  }
  return Array.from(seen.values());
}

function safeTruncateSection(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  let currentTokens = 0;
  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');
    if (currentTokens + lineTokens > maxTokens) break;
    kept.push(line);
    currentTokens += lineTokens;
  }
  if (kept.length > 0) return kept.join('\n');
  return '';
}

export function buildContextPack(chunks: EvidenceChunk[], budgetName: RecallBudget, ceiling = 2500): ContextPack {
  const budget = Math.min(TOKEN_BUDGETS[budgetName], ceiling);
  const selected: EvidenceChunk[] = [];
  const sections: string[] = [];
  let used = 0;

  const deduped = deduplicateEvidenceChunks(chunks);
  for (const chunk of rankEvidenceChunks(deduped)) {
    const prefix = `[${chunk.source}] ${chunk.reference}\n`;
    const prefixTokens = estimateTokens(prefix);
    const remaining = budget - used - prefixTokens;
    if (remaining <= 0) break;
    const text = safeTruncateSection(chunk.text, remaining);
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
