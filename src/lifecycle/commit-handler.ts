import { createHash } from 'node:crypto';

import type { MegaBrainGitHook } from '../hooks/git/multiplexer.js';
import type { KnowledgeType } from '../learning/taxonomy.js';
import type { ProvenanceDatabase } from '../provenance/database.js';
import { revalidateAfterChange, type RevalidationDependencies, type RevalidationResult } from './revalidation.js';

export class HookEventLedger {
  constructor(readonly database: ProvenanceDatabase) {}

  claim(key: string, eventType: string, payload: unknown): boolean {
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO hook_events(idempotency_key, event_type, payload_hash, processed_at)
      VALUES(?, ?, ?, NULL)
    `).run(key, eventType, payloadHash);
    return result.changes === 1;
  }

  complete(key: string, now = new Date()): void {
    this.database.prepare('UPDATE hook_events SET processed_at = ? WHERE idempotency_key = ?').run(now.toISOString(), key);
  }

  release(key: string): void {
    this.database.prepare('DELETE FROM hook_events WHERE idempotency_key = ? AND processed_at IS NULL').run(key);
  }
}

export interface GitEventDependencies {
  ledger: HookEventLedger;
  changedPaths(event: MegaBrainGitHook, commitHash: string): Promise<string[]>;
  updateGraph(commitHash: string): Promise<void>;
  linkSession(commitHash: string): Promise<void>;
  revalidation: RevalidationDependencies;
}

export async function handleGitEvent(
  input: { key: string; event: MegaBrainGitHook; commitHash: string },
  dependencies: GitEventDependencies,
): Promise<{ duplicate: boolean; revalidation?: RevalidationResult }> {
  if (!dependencies.ledger.claim(input.key, input.event, input)) return { duplicate: true };
  try {
    const paths = await dependencies.changedPaths(input.event, input.commitHash);
    await dependencies.updateGraph(input.commitHash);
    const revalidation = await revalidateAfterChange(paths, input.commitHash, dependencies.revalidation);
    await dependencies.linkSession(input.commitHash);
    dependencies.ledger.complete(input.key);
    return { duplicate: false, revalidation };
  } catch (error) {
    dependencies.ledger.release(input.key);
    throw error;
  }
}

export interface ExtractedCommitLearning {
  statement: string;
  type: KnowledgeType;
  confidence: number;
  commitHash: string;
  files: string[];
}

export function extractLearningFromCommit(commit: {
  hash: string;
  subject: string;
  files?: string[];
}): ExtractedCommitLearning | null {
  const subject = commit.subject.trim();
  const files = commit.files ?? [];

  // Conventional Commits parsing: <type>(<scope>): <description> or <type>: <description>
  const match = subject.match(/^(feat|fix|refactor|perf|chore|docs|style|test)(?:\(([^)]+)\))?!?: (.+)$/i);
  if (!match || !match[1] || !match[3]) return null;

  const rawType = match[1];
  const scope = match[2];
  const description = match[3];
  const normalizedType = rawType.toLowerCase();

  let type: KnowledgeType = 'decision';
  if (normalizedType === 'fix') {
    type = 'bug';
  } else if (normalizedType === 'feat' || normalizedType === 'refactor') {
    type = 'decision';
  } else {
    type = 'fact';
  }

  const statement = scope
    ? `[${scope}] ${description}`
    : description;

  return {
    statement,
    type,
    confidence: 0.7,
    commitHash: commit.hash,
    files,
  };
}
