import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { GitRepository } from './repository.js';

export async function committedBlobHash(repository: GitRepository, file: string, revision = 'HEAD'): Promise<string | null> {
  try {
    return (await repository.run(['rev-parse', `${revision}:${file}`])).trim();
  } catch {
    return null;
  }
}

export async function workingTreeContentHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
