import type { KnowledgeType } from '../learning/taxonomy.js';

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
  if (!match) return null;

  const [, rawType, scope, description] = match;
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
