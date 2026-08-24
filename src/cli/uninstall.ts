import { access, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { withRuntimeTransaction } from '../runtime/transaction.js';

export interface ReversibleUninstallParticipant {
  apply(): Promise<void>;
  rollback(): Promise<void>;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

export async function uninstallMegaBrain(input: {
  dataDir: string;
  identity: ProjectIdentity;
  participants?: ReversibleUninstallParticipant[];
  purge?: boolean;
}): Promise<{ dataPreserved: boolean }> {
  const layout = runtimeLayout(input.dataDir, input.identity);
  const quarantinedRuntime = path.join(layout.runtimeRoot, `.uninstall-${Date.now()}-${process.pid}`);
  await withRuntimeTransaction(async (transaction) => {
    for (const participant of input.participants ?? []) {
      await participant.apply();
      transaction.addRollback(() => participant.rollback());
    }
    if (await exists(layout.current)) {
      await rename(layout.current, quarantinedRuntime);
      transaction.addRollback(() => rename(quarantinedRuntime, layout.current));
    }
  });
  await rm(quarantinedRuntime, { recursive: true, force: true });
  await rm(layout.stateFile, { force: true });
  if (input.purge) await rm(layout.projectRoot, { recursive: true, force: true });
  return { dataPreserved: !input.purge };
}
