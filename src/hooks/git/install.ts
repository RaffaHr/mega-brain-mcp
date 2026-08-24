import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { GitRepository } from '../../adapters/git/repository.js';
import { MEGA_BRAIN_GIT_HOOKS, renderHookMultiplexer } from './multiplexer.js';

interface GitHooksBackup {
  previousHooksPath: string | null;
  previousResolvedHooksPath: string;
}

async function configuredHooksPath(repository: GitRepository): Promise<string | null> {
  try {
    const value = (await repository.run(['config', '--local', '--get', 'core.hooksPath'])).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function defaultHooksPath(repository: GitRepository): Promise<string> {
  return path.resolve(repository.root, (await repository.run(['rev-parse', '--git-path', 'hooks'])).trim());
}

export async function installGitHookMultiplexer(input: {
  repository: GitRepository;
  managedHooksPath: string;
  megaBrainCommand: string[];
}): Promise<GitHooksBackup> {
  const managed = path.resolve(input.managedHooksPath);
  const backupPath = path.join(managed, 'installation.json');
  let backup: GitHooksBackup;
  try {
    backup = JSON.parse(await readFile(backupPath, 'utf8')) as GitHooksBackup;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const previousHooksPath = await configuredHooksPath(input.repository);
    const previousResolvedHooksPath = previousHooksPath
      ? path.resolve(input.repository.root, previousHooksPath)
      : await defaultHooksPath(input.repository);
    backup = { previousHooksPath, previousResolvedHooksPath };
  }
  await mkdir(managed, { recursive: true });
  await writeFile(backupPath, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 });
  for (const event of MEGA_BRAIN_GIT_HOOKS) {
    const target = path.join(managed, event);
    const script = renderHookMultiplexer({
      event,
      previousHook: path.join(backup.previousResolvedHooksPath, event),
      megaBrainCommand: input.megaBrainCommand,
    });
    await writeFile(target, script, { encoding: 'utf8', mode: 0o755 });
    await chmod(target, 0o755);
  }
  await input.repository.run(['config', '--local', 'core.hooksPath', managed]);
  return backup;
}

export async function restoreGitHooks(repository: GitRepository, managedHooksPath: string): Promise<void> {
  const backup = JSON.parse(await readFile(path.join(path.resolve(managedHooksPath), 'installation.json'), 'utf8')) as GitHooksBackup;
  if (backup.previousHooksPath === null) {
    try {
      await repository.run(['config', '--local', '--unset', 'core.hooksPath']);
    } catch {
      // Already restored.
    }
  } else {
    await repository.run(['config', '--local', 'core.hooksPath', backup.previousHooksPath]);
  }
}
