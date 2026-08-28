import { installManagedRuntime, type InstallRuntimeOptions, type RuntimeInspection } from './install.js';
import { inspectManagedRuntime } from './install.js';
import { type RuntimeLockManifest } from '../runtime/lock-manifest.js';
import { type RuntimeTransaction, withRuntimeTransaction } from '../runtime/transaction.js';

export async function upgradeManagedRuntime(
  options: InstallRuntimeOptions & {
    configure?: (transaction: RuntimeTransaction, manifest: RuntimeLockManifest) => Promise<void>;
    validate?: (inspection: RuntimeInspection) => Promise<void>;
  },
): Promise<RuntimeInspection> {
  const { configure, validate, ...runtimeOptions } = options;
  return withRuntimeTransaction(async (transaction) => {
    const manifest = await installManagedRuntime({ ...runtimeOptions, transaction });
    await configure?.(transaction, manifest);
    const inspection = await inspectManagedRuntime(options.dataDir, options.identity);
    await validate?.(inspection);
    return inspection;
  });
}