import path from 'node:path';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readRuntimeLock } from '../runtime/lock-manifest.js';
import { startRuntime, type ProcessController, type RuntimeState } from '../runtime/supervisor.js';

export async function startManagedRuntime(
  dataDir: string,
  identity: ProjectIdentity,
  controller?: ProcessController,
): Promise<RuntimeState> {
  const layout = runtimeLayout(dataDir, identity);
  const manifest = await readRuntimeLock(path.join(layout.current, 'runtime-lock.json'));
  return startRuntime(layout, manifest, controller);
}
