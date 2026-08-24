import { access, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { installManagedRuntime, type InstallRuntimeOptions, type RuntimeInspection } from './install.js';
import { inspectManagedRuntime } from './install.js';
import { runtimeLayout } from '../runtime/layout.js';
import { withRuntimeTransaction } from '../runtime/transaction.js';

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

export async function upgradeManagedRuntime(
  options: InstallRuntimeOptions & { validate?: (inspection: RuntimeInspection) => Promise<void> },
): Promise<RuntimeInspection> {
  const layout = runtimeLayout(options.dataDir, options.identity);
  const backup = path.join(layout.runtimeRoot, `.upgrade-backup-${Date.now()}-${process.pid}`);
  return withRuntimeTransaction(async (transaction) => {
    if (await exists(layout.current)) {
      await rename(layout.current, backup);
      transaction.addRollback(async () => {
        await rm(layout.current, { recursive: true, force: true });
        await rename(backup, layout.current);
      });
    }
    await installManagedRuntime(options);
    const inspection = await inspectManagedRuntime(options.dataDir, options.identity);
    await options.validate?.(inspection);
    await rm(backup, { recursive: true, force: true });
    return inspection;
  });
}
