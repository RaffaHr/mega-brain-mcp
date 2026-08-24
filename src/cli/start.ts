import path from 'node:path';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readRuntimeLock } from '../runtime/lock-manifest.js';
import { startRuntime, type ProcessController, type RuntimeState } from '../runtime/supervisor.js';
import type { AgentMemoryMode } from '../runtime/types.js';

export interface StartManagedRuntimeOptions {
  agentMemoryMode?: AgentMemoryMode;
  agentMemoryEnvironment?: Record<string, string>;
  controller?: ProcessController;
}

export async function startManagedRuntime(
  dataDir: string,
  identity: ProjectIdentity,
  options: StartManagedRuntimeOptions = {},
): Promise<RuntimeState> {
  const layout = runtimeLayout(dataDir, identity);
  const manifest = await readRuntimeLock(path.join(layout.current, 'runtime-lock.json'));
  const agentMemoryMode = options.agentMemoryMode ?? manifest.agentMemoryMode;
  return startRuntime(layout, manifest, options.controller, {
    agentMemoryMode,
    environment: agentMemoryMode === 'managed' && options.agentMemoryEnvironment
      ? { agentMemory: options.agentMemoryEnvironment }
      : {},
  });
}
