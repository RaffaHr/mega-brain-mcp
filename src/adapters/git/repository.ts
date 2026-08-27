import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const NO_GIT_HEAD = 'NO_GIT';

export function isGitHeadUnavailable(error: unknown): boolean {
  const stderr = String((error as { stderr?: unknown }).stderr ?? '');
  return stderr.includes("ambiguous argument 'HEAD'")
    || stderr.includes('unknown revision or path not in the working tree')
    || stderr.includes('does not have any commits yet')
    || stderr.includes("bad revision 'HEAD'")
    || stderr.includes("bad default revision 'HEAD'");
}

export interface GitStatusEntry {
  index: string;
  worktree: string;
  path: string;
  origPath?: string;
}

export class GitRepository {
  private constructor(readonly root: string) {}

  static async discover(cwd: string): Promise<GitRepository> {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
    return new GitRepository(await realpath(stdout.trim()));
  }

  async run(args: string[], options: { maxBuffer?: number } = {}): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', this.root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    });
    return stdout;
  }

  async head(): Promise<string> {
    try {
      return (await this.run(['rev-parse', 'HEAD'])).trim();
    } catch (error) {
      if (isGitHeadUnavailable(error)) return NO_GIT_HEAD;
      throw error;
    }
  }

  async status(): Promise<GitStatusEntry[]> {
    const raw = await this.run(['status', '--porcelain=v1', '-z']);
    const tokens = raw.split('\0').filter(Boolean);
    const entries: GitStatusEntry[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const entry = tokens[i];
      if (!entry) continue;
      const index = entry[0] ?? ' ';
      const worktree = entry[1] ?? ' ';
      const path = entry.slice(3);
      if (index === 'R' || worktree === 'R' || index === 'C' || worktree === 'C') {
        const origPath = tokens[++i];
        entries.push({ index, worktree, path, ...(origPath ? { origPath } : {}) });
      } else {
        entries.push({ index, worktree, path });
      }
    }
    return entries;
  }

  async trackedFiles(): Promise<string[]> {
    return (await this.run(['ls-files', '-z'])).split('\0').filter(Boolean);
  }

  async changedFiles(base = 'HEAD'): Promise<string[]> {
    try {
      return (await this.run(['diff', '--name-only', '-z', base])).split('\0').filter(Boolean);
    } catch (error) {
      if (base === 'HEAD' && isGitHeadUnavailable(error)) return (await this.status()).map(({ path: changedPath }) => changedPath);
      throw error;
    }
  }

  async worktrees(): Promise<Array<Record<string, string>>> {
    const blocks = (await this.run(['worktree', 'list', '--porcelain'])).trim().split(/\r?\n\r?\n/);
    return blocks.filter(Boolean).map((block) =>
      Object.fromEntries(block.split(/\r?\n/).map((line) => {
        const separator = line.indexOf(' ');
        return separator === -1 ? [line, 'true'] : [line.slice(0, separator), line.slice(separator + 1)];
      })),
    );
  }
}
