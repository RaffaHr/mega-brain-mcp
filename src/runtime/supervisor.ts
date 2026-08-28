import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeLayout } from './layout.js';
import type { RuntimeLockManifest } from './lock-manifest.js';
import type { AgentMemoryMode, RuntimeBackendName, RuntimeCommand, RuntimeEnvironment } from './types.js';

export interface ManagedProcess {
  pid: number;
  stop(): Promise<void>;
}

export interface ProcessController {
  start(command: RuntimeCommand, logFile: string, environment?: NodeJS.ProcessEnv): Promise<ManagedProcess>;
}

export const systemProcessController: ProcessController = {
  async start(command, logFile, environment) {
    const log = await open(logFile, 'a');
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, {
        cwd: command.cwd,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...(command.prependPath ? { PATH: `${command.prependPath}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
          ...(environment ?? {}),
        },
        stdio: ['ignore', log.fd, log.fd],
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (error) {
      await log.close();
      throw new Error(`Failed to start ${command.command}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await log.close();
    if (!child.pid) throw new Error(`Failed to start ${command.command}: process has no pid`);
    child.unref();
    return {
      pid: child.pid,
      async stop() {
        try { process.kill(child.pid!, 'SIGTERM'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      },
    };
  },
};

export interface RuntimeState {
  startedAt: string;
  agentMemoryMode: AgentMemoryMode;
  processes: Record<string, number>;
}

export interface StartRuntimeOptions {
  agentMemoryMode?: AgentMemoryMode;
  environment?: RuntimeEnvironment;
  ready?: () => Promise<void>;
}

export async function startRuntime(
  layout: RuntimeLayout,
  manifest: RuntimeLockManifest,
  controller: ProcessController = systemProcessController,
  options: StartRuntimeOptions = {},
): Promise<RuntimeState> {
  await mkdir(layout.logsDir, { recursive: true });
  const started: ManagedProcess[] = [];
  const processes: Record<string, number> = {};
  const agentMemoryMode = options.agentMemoryMode ?? manifest.agentMemoryMode;
  if (agentMemoryMode === 'managed' && !manifest.backends.agentMemory) {
    throw new Error('AgentMemory managed runtime is not installed; run mega-brain setup or upgrade in managed mode');
  }
  try {
    for (const [name, command] of Object.entries(manifest.backends)) {
      if (name === 'agentMemory' && agentMemoryMode === 'remote') continue;
      if (!command) continue;
      if (command.lifecycle !== 'daemon') continue;
      const backend = name as RuntimeBackendName;
      const managed = await controller.start(
        command,
        path.join(layout.logsDir, `${name}.log`),
        { ...command.environment, ...options.environment?.[backend] },
      );
      started.push(managed);
      processes[name] = managed.pid;
    }
    await options.ready?.();
    const state = { startedAt: new Date().toISOString(), agentMemoryMode, processes };
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
