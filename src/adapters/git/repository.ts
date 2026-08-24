import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitStatusEntry {
  index: string;
  worktree: string;
  path: string;
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
    return (await this.run(['rev-parse', 'HEAD'])).trim();
  }

  async status(): Promise<GitStatusEntry[]> {
    return (await this.run(['status', '--porcelain=v1', '-z']))
      .split('\0')
      .filter(Boolean)
      .map((entry) => ({ index: entry[0] ?? ' ', worktree: entry[1] ?? ' ', path: entry.slice(3) }));
  }

  async trackedFiles(): Promise<string[]> {
    return (await this.run(['ls-files', '-z'])).split('\0').filter(Boolean);
  }

  async changedFiles(base = 'HEAD'): Promise<string[]> {
    return (await this.run(['diff', '--name-only', '-z', base])).split('\0').filter(Boolean);
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
