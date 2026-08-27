import type { GitRepository } from './repository.js';
import { isGitHeadUnavailable } from './repository.js';

export interface GitCommit {
  hash: string;
  parentHashes: string[];
  authoredAt: string;
  subject: string;
  files?: string[];
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

export interface CoChangeResult {
  coChangedFiles: string[];
  coChangeRates: Record<string, number>;
  totalTargetCommits: number;
}

export async function calculateCoChangeCoupling(
  repository: GitRepository,
  targetFile: string,
  threshold = 0.4,
  sinceMonths = 6,
): Promise<CoChangeResult> {
  const normalizedTarget = targetFile.replaceAll('\\', '/');
  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - sinceMonths);
  const sinceIso = sinceDate.toISOString();

  const output = await repository.run([
    'log',
    `--since=${sinceIso}`,
    '--name-only',
    '--format=COMMIT:%H',
  ]).catch((error) => {
    if (isGitHeadUnavailable(error)) return '';
    throw error;
  });

  const commitBlocks = output.split(/COMMIT:[a-f0-9]{40}/).filter(Boolean);
  let targetCommitsCount = 0;
  const partnerCounts = new Map<string, number>();

  for (const block of commitBlocks) {
    const files = block
      .split(/\r?\n/)
      .map((f) => f.trim().replaceAll('\\', '/'))
      .filter(Boolean);

    if (files.includes(normalizedTarget)) {
      targetCommitsCount++;
      for (const file of files) {
        if (file !== normalizedTarget) {
          partnerCounts.set(file, (partnerCounts.get(file) ?? 0) + 1);
        }
      }
    }
  }

  const coChangedFiles: string[] = [];
  const coChangeRates: Record<string, number> = {};

  if (targetCommitsCount > 0) {
    for (const [file, count] of partnerCounts) {
      const rate = count / targetCommitsCount;
      if (rate >= threshold) {
        coChangedFiles.push(file);
        coChangeRates[file] = Number(rate.toFixed(2));
      }
    }
  }

  coChangedFiles.sort();
  return { coChangedFiles, coChangeRates, totalTargetCommits: targetCommitsCount };
}

export async function gitSymbolHistory(
  repository: GitRepository,
  symbol: string,
  limit = 20,
): Promise<GitCommit[]> {
  if (!symbol || !symbol.trim()) return [];
  const sanitizedSymbol = symbol.trim();
  const output = await repository.run([
    'log',
    `--max-count=${limit}`,
    `-S${sanitizedSymbol}`,
    '--format=%H%x00%P%x00%aI%x00%s',
  ]).catch((error) => {
    if (isGitHeadUnavailable(error)) return '';
    throw error;
  });

  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash = '', parents = '', authoredAt = '', subject = ''] = line.split('\0');
    return { hash, parentHashes: parents ? parents.split(' ') : [], authoredAt, subject };
  });
}
