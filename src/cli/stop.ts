import { rm } from 'node:fs/promises';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readRuntimeState } from '../runtime/supervisor.js';

export interface ProcessStopper {
  stop(pid: number): Promise<void>;
}

export const systemProcessStopper: ProcessStopper = {
  async stop(pid) {
    process.kill(pid, 'SIGTERM');
  },
};

export async function stopManagedRuntime(
  dataDir: string,
  identity: ProjectIdentity,
  stopper: ProcessStopper = systemProcessStopper,
): Promise<void> {
  const layout = runtimeLayout(dataDir, identity);
  const state = await readRuntimeState(layout);
  await Promise.allSettled(Object.values(state.processes).map((pid) => stopper.stop(pid)));
  await rm(layout.stateFile, { force: true });
}
