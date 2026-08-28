import { rm } from 'node:fs/promises';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { processTreeStopper, sweepRuntimeProcesses } from '../runtime/process-tree.js';
import { readRuntimeState } from '../runtime/supervisor.js';

export interface ProcessStopper {
  stop(pid: number): Promise<void>;
}

export interface StopManagedRuntimeOptions {
  processExists?: (pid: number) => boolean | Promise<boolean>;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  sweep?: boolean;
}

export const systemProcessStopper: ProcessStopper = processTreeStopper();

async function defaultProcessExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForStopped(pids: number[], options: StopManagedRuntimeOptions): Promise<void> {
  const processExists = options.processExists ?? defaultProcessExists;
  const deadline = Date.now() + (options.waitTimeoutMs ?? 5_000);
  let stillRunning: number[] = pids;
  do {
    stillRunning = [];
    for (const pid of pids) {
      if (await processExists(pid)) stillRunning.push(pid);
    }
    if (stillRunning.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 100));
  } while (Date.now() < deadline);
  throw new Error(`Runtime processes did not stop within ${options.waitTimeoutMs ?? 5_000}ms: ${stillRunning.join(', ')}`);
}

export async function stopManagedRuntime(
  dataDir: string,
  identity: ProjectIdentity,
  stopper: ProcessStopper = systemProcessStopper,
  options: StopManagedRuntimeOptions = {},
): Promise<void> {
  const layout = runtimeLayout(dataDir, identity);
  let state;
  try { state = await readRuntimeState(layout); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (options.sweep !== false) {
        await sweepRuntimeProcesses(layout.runtimeRoot).catch(() => []);
      }
      return;
    }
    throw error;
  }
  const pids = Object.values(state.processes);
  await Promise.allSettled(pids.map((pid) => stopper.stop(pid)));
  await waitForStopped(pids, options);
  if (options.sweep !== false) {
    await sweepRuntimeProcesses(layout.runtimeRoot).catch(() => []);
  }
  await rm(layout.stateFile, { force: true });
}