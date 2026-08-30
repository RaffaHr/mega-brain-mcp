import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  escapedForExtendedRegex,
  findProcessesInPath,
  processTreeStopper,
  sweepRuntimeProcesses,
  terminateProcessTree,
} from '../../src/runtime/process-tree.js';

describe('Process Tree Stopper and Process Verification', () => {
  test('terminates process tree on Windows using taskkill /F /T /PID', async () => {
    const executed: Array<{ file: string; args: string[] }> = [];
    const mockExec = vi.fn(async (file: string, args: readonly string[]) => {
      executed.push({ file, args: [...args] });
      return { stdout: 'SUCCESS: The process with PID 1234 (child of PID 5678) has been terminated.\n', stderr: '' };
    });

    await terminateProcessTree(1234, {
      platform: 'win32',
      execFile: mockExec as never,
    });

    expect(executed).toEqual([
      { file: 'taskkill', args: ['/F', '/T', '/PID', '1234'] },
    ]);
  });

  test('tolerates already-dead process or non-existent PID on Windows without throwing', async () => {
    const mockExec = vi.fn(async () => {
      const error = new Error('ERROR: The process "9999" not found.');
      throw error;
    });

    await expect(terminateProcessTree(9999, {
      platform: 'win32',
      execFile: mockExec as never,
    })).resolves.toBeUndefined();
  });

  test('sweeps processes running under a runtime directory path on Windows', async () => {
    const mockExec = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === 'powershell' || file === 'pwsh') {
        return {
          stdout: '1001\n1002\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const terminated: number[] = [];

    const pids = await sweepRuntimeProcesses('C:\\Users\\Raffa\\AppData\\Local\\mega-brain\\projects\\123\\runtime', {
      platform: 'win32',
      execFile: mockExec as never,
      terminate: async (pid) => { terminated.push(pid); },
    });

    expect(pids).toEqual([1001, 1002]);
    expect(terminated).toEqual([1001, 1002]);
  });

  test('preserves the runtime path capitalization when matching processes on POSIX', async () => {
    const executed: Array<{ file: string; args: string[] }> = [];
    const mockExec = vi.fn(async (file: string, args: readonly string[]) => {
      executed.push({ file, args: [...args] });
      return { stdout: '', stderr: '' };
    });

    await findProcessesInPath('/tmp/Mega Brain/Runtime', {
      platform: 'linux',
      execFile: mockExec as never,
    });

    expect(executed).toHaveLength(1);
    expect(executed[0]!.file).toBe('pgrep');
    expect(executed[0]!.args[0]).toBe('-f');
    expect(executed[0]!.args[1]).toBe(escapedForExtendedRegex(path.resolve('/tmp/Mega Brain/Runtime')));
    expect(executed[0]!.args[1]).toContain('Mega Brain');
    expect(executed[0]!.args[1]).not.toContain('mega brain');
  });

  test('lowercases the runtime path only for the case-insensitive Windows lookup', async () => {
    const executed: Array<{ file: string; args: string[] }> = [];
    const mockExec = vi.fn(async (file: string, args: readonly string[]) => {
      executed.push({ file, args: [...args] });
      return { stdout: '', stderr: '' };
    });

    await findProcessesInPath('/tmp/Mega Brain/Runtime', {
      platform: 'win32',
      execFile: mockExec as never,
    });

    expect(executed).toHaveLength(1);
    expect(executed[0]!.file).toBe('powershell');
    const script = executed[0]!.args.at(-1)!;
    expect(script).toContain('mega brain');
    expect(script).not.toContain('Mega Brain');
  });

  test('escapes regex metacharacters before handing the path to pgrep', async () => {
    const executed: Array<{ file: string; args: string[] }> = [];
    const mockExec = vi.fn(async (file: string, args: readonly string[]) => {
      executed.push({ file, args: [...args] });
      return { stdout: '', stderr: '' };
    });

    await findProcessesInPath('/tmp/Projects (old)/mega-brain+1/runtime', {
      platform: 'linux',
      execFile: mockExec as never,
    });

    expect(executed).toHaveLength(1);
    expect(executed[0]!.file).toBe('pgrep');
    expect(executed[0]!.args[1]).toContain('Projects \\(old\\)');
    expect(executed[0]!.args[1]).toContain('mega-brain\\+1');
  });

  test('processTreeStopper delegates to terminateProcessTree', async () => {
    const stopper = processTreeStopper({
      platform: 'win32',
      execFile: (async () => ({ stdout: '', stderr: '' })) as never,
    });

    await expect(stopper.stop(5555)).resolves.toBeUndefined();
  });
});