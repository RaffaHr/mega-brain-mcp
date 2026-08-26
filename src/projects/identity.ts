import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProjectIdentityInput {
  root: string;
  gitDir: string;
  commonGitDir: string;
  remote?: string;
  gitBacked?: boolean;
}

export interface ProjectIdentity {
  repositoryId: string;
  checkoutId: string;
  worktreeId: string;
  root: string;
  gitDir: string;
  commonGitDir: string;
  remote: string | null;
  gitBacked: boolean;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizedPath(value: string): string {
  const resolved = path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function normalizeRemote(remote: string | undefined): string | null {
  if (!remote?.trim()) return null;
  const value = remote.trim();
  const scp = value.includes('://') ? null : /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
  if (scp) return `${scp[1]?.toLowerCase()}/${scp[2]?.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')}`;

  try {
    const url = new URL(value);
    const repositoryPath = decodeURIComponent(url.pathname).replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    if (url.protocol === 'file:') return `file:${normalizedPath(repositoryPath)}`;
    return `${url.hostname.toLowerCase()}/${repositoryPath}`;
  } catch {
    return normalizedPath(value.replace(/\.git$/i, ''));
  }
}

export function deriveProjectIdentity(input: ProjectIdentityInput): ProjectIdentity {
  const root = normalizedPath(input.root);
  const gitDir = normalizedPath(path.resolve(input.root, input.gitDir));
  const commonGitDir = normalizedPath(path.resolve(input.root, input.commonGitDir));
  const remote = normalizeRemote(input.remote);
  const repositoryId = digest(remote ?? commonGitDir);
  const checkoutId = digest(`${repositoryId}\0${root}`);
  const worktreeId = digest(`${checkoutId}\0${gitDir}`);
  return { repositoryId, checkoutId, worktreeId, root, gitDir, commonGitDir, remote, gitBacked: input.gitBacked ?? true };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  return stdout.trim();
}

export async function discoverProjectIdentity(cwd: string): Promise<ProjectIdentity> {
  let requestedRoot: string;
  try {
    requestedRoot = await realpath(cwd);
  } catch {
    requestedRoot = path.resolve(cwd);
  }
  try {
    const root = await realpath(await git(cwd, 'rev-parse', '--show-toplevel'));
    const [gitDir, commonGitDir, remote] = await Promise.all([
      git(root, 'rev-parse', '--git-dir'),
      git(root, 'rev-parse', '--git-common-dir'),
      git(root, 'remote', 'get-url', 'origin').catch(() => ''),
    ]);
    return deriveProjectIdentity({ root, gitDir, commonGitDir, remote, gitBacked: true });
  } catch {
    const marker = path.join('.mega-brain', 'non-git-project');
    return deriveProjectIdentity({
      root: requestedRoot,
      gitDir: marker,
      commonGitDir: marker,
      gitBacked: false,
    });
  }
}
