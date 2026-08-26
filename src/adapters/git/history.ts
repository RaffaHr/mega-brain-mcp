import type { GitRepository } from './repository.js';
import { isGitHeadUnavailable } from './repository.js';

export interface GitCommit {
  hash: string;
  parentHashes: string[];
  authoredAt: string;
  subject: string;
}

export async function gitHistory(repository: GitRepository, limit = 50, paths: string[] = []): Promise<GitCommit[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Git history limit must be between 1 and 500');
  const output = await repository.run([
    'log',
    `--max-count=${limit}`,
    '--format=%H%x00%P%x00%aI%x00%s',
    ...(paths.length ? ['--', ...paths] : []),
  ]).catch((error) => {
    if (isGitHeadUnavailable(error)) return '';
    throw error;
  });
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash = '', parents = '', authoredAt = '', subject = ''] = line.split('\0');
    return { hash, parentHashes: parents ? parents.split(' ') : [], authoredAt, subject };
  });
}
