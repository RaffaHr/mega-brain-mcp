import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { GitRepository } from './repository.js';

export interface SafeReadOptions {
  maxBytes?: number;
  maxLines?: number;
  resolveRealPath?: (value: string) => Promise<string>;
  isTracked?: (relativePath: string) => Promise<boolean>;
}

export interface SafeReadResult {
  path: string;
  content: string;
  bytes: number;
  lines: number;
  truncated: boolean;
}

export async function safeReadTrackedFile(
  repository: GitRepository,
  requestedPath: string,
  options: SafeReadOptions = {},
): Promise<SafeReadResult> {
  if (!requestedPath || path.isAbsolute(requestedPath)) throw new Error('Only repository-relative paths are allowed');
  const normalized = requestedPath.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) throw new Error('Path traversal is not allowed');

  const resolveRealPath = options.resolveRealPath ?? realpath;
  const root = await resolveRealPath(repository.root);
  const candidate = await resolveRealPath(path.resolve(root, normalized));
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Resolved path is outside the repository');

  const gitPath = relative.replaceAll('\\', '/');
  const isTracked = options.isTracked ?? (async (value: string) => {
    try {
      await repository.run(['ls-files', '--error-unmatch', '--', value]);
      return true;
    } catch {
      return false;
    }
  });
  if (!(await isTracked(gitPath))) throw new Error('File is not tracked by Git');

  const maxBytes = options.maxBytes ?? 128 * 1024;
  const maxLines = options.maxLines ?? 400;
  const metadata = await stat(candidate);
  if (!metadata.isFile()) throw new Error('Tracked path is not a regular file');
  const raw = await readFile(candidate);
  const byteLimited = raw.subarray(0, maxBytes);
  const decoded = byteLimited.toString('utf8');
  const allLines = decoded.split(/\r?\n/);
  const content = allLines.slice(0, maxLines).join('\n');
  const returnedBytes = Buffer.byteLength(content);
  return {
    path: gitPath,
    content,
    bytes: returnedBytes,
    lines: Math.min(allLines.length, maxLines),
    truncated: metadata.size > maxBytes || allLines.length > maxLines,
  };
}
