import path from 'node:path';

import type { CodeReviewGraphClient } from './client.js';

export interface CodeReviewGraphIsolation {
  dataDir: string;
  repoRoot: string;
}

export function probeCodeReviewGraphIsolation(
  client: CodeReviewGraphClient,
  expectedRepoRoot: string,
): CodeReviewGraphIsolation {
  const environment = client.effectiveEnvironment();
  const dataDir = environment.CRG_DATA_DIR;
  const repoRoot = environment.CRG_REPO_ROOT;
  if (!dataDir || !repoRoot || !path.isAbsolute(dataDir) || !path.isAbsolute(repoRoot)) {
    throw new Error('Code Review Graph did not declare absolute isolated storage paths');
  }
  if (path.resolve(repoRoot) !== path.resolve(expectedRepoRoot)) {
    throw new Error('Code Review Graph repository identity does not match the selected worktree');
  }
  return { dataDir, repoRoot };
}
