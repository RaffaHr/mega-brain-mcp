import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ExecFileFunction = (
  file: string,
  args: readonly string[],
  options?: { encoding?: BufferEncoding; windowsHide?: boolean; timeout?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface ProcessTreeOptions {
  platform?: NodeJS.Platform;
  execFile?: ExecFileFunction;
  force?: boolean;
}

export interface SweepProcessesOptions extends ProcessTreeOptions {
  terminate?: (pid: number) => Promise<void>;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

export async function terminateProcessTree(
  pid: number,
  options: ProcessTreeOptions = {},
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const platform = options.platform ?? process.platform;
  const exec = options.execFile ?? (execFileAsync as ExecFileFunction);

  if (platform === 'win32') {
    try {
      await exec('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isNotFound = msg.includes('not found') || msg.includes('não encontrado') || msg.includes('PID');
      const isDead = (error as NodeJS.ErrnoException).code === 'ESRCH';
      if (isNotFound || isDead) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (killError) {
        if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError;
      }
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
}

export async function findProcessesInPath(
  pathPrefix: string,
  options: ProcessTreeOptions = {},
): Promise<number[]> {
  const platform = options.platform ?? process.platform;
  const exec = options.execFile ?? (execFileAsync as ExecFileFunction);
  const normalizedTarget = path.resolve(pathPrefix).toLowerCase();

  if (!options.execFile && !(await exists(normalizedTarget))) {
    return [];
  }

  if (platform === 'win32') {
    try {
      const escaped = normalizedTarget.replaceAll("'", "''");
      const script = `Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('${escaped}')) -or ($_.CommandLine -and $_.CommandLine.ToLower().Contains('${escaped}')) } | Select-Object -ExpandProperty ProcessId`;
      const { stdout } = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 10_000,
      });
      const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return lines.map((line) => Number(line)).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    } catch {
      return [];
    }
  } else {
    try {
      const { stdout } = await exec('pgrep', ['-f', normalizedTarget], { timeout: 10_000 });
      const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return lines.map((line) => Number(line)).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    } catch {
      return [];
    }
  }
}

export async function sweepRuntimeProcesses(
  runtimeRoot: string,
  options: SweepProcessesOptions = {},
): Promise<number[]> {
  const pids = await findProcessesInPath(runtimeRoot, options);
  const terminate = options.terminate ?? ((pid: number) => terminateProcessTree(pid, options));
  for (const pid of pids) {
    await terminate(pid).catch(() => undefined);
  }
  return pids;
}

export function processTreeStopper(options: ProcessTreeOptions = {}): { stop(pid: number): Promise<void> } {
  return {
    async stop(pid: number) {
      await terminateProcessTree(pid, options);
    },
  };
}