import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeLayout } from './layout.js';
import type { RuntimeLockManifest } from './lock-manifest.js';
import type { RuntimeCommand } from './types.js';

export interface ManagedProcess {
  pid: number;
  stop(): Promise<void>;
}

export interface ProcessController {
  start(command: RuntimeCommand, logFile: string): Promise<ManagedProcess>;
}

export const systemProcessController: ProcessController = {
  async start(command, logFile) {
    const child: ChildProcess = spawn(command.command, command.args, {
      cwd: command.cwd,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!child.pid) throw new Error(`Failed to start ${command.command}`);
    child.unref();
    await writeFile(logFile, '', { flag: 'a' });
    return {
      pid: child.pid,
      async stop() {
        process.kill(child.pid!, 'SIGTERM');
      },
    };
  },
};

export interface RuntimeState {
  startedAt: string;
  processes: Record<string, number>;
}

export async function startRuntime(
  layout: RuntimeLayout,
  manifest: RuntimeLockManifest,
  controller: ProcessController = systemProcessController,
): Promise<RuntimeState> {
  await mkdir(layout.logsDir, { recursive: true });
  const started: ManagedProcess[] = [];
  const processes: Record<string, number> = {};
  try {
    for (const [name, command] of Object.entries(manifest.backends)) {
      if (command.lifecycle !== 'daemon') continue;
      const managed = await controller.start(command, path.join(layout.logsDir, `${name}.log`));
      started.push(managed);
      processes[name] = managed.pid;
    }
    const state = { startedAt: new Date().toISOString(), processes };
    await writeFile(layout.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
  } catch (error) {
    await Promise.allSettled(started.reverse().map((process) => process.stop()));
    throw error;
  }
}

export async function readRuntimeState(layout: RuntimeLayout): Promise<RuntimeState> {
  return JSON.parse(await readFile(layout.stateFile, 'utf8')) as RuntimeState;
}
