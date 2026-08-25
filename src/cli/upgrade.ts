import { installManagedRuntime, type InstallRuntimeOptions, type RuntimeInspection } from './install.js';
import { inspectManagedRuntime } from './install.js';
import { withRuntimeTransaction } from '../runtime/transaction.js';

export async function upgradeManagedRuntime(
  options: InstallRuntimeOptions & { validate?: (inspection: RuntimeInspection) => Promise<void> },
): Promise<RuntimeInspection> {
  const { validate, ...runtimeOptions } = options;
  return withRuntimeTransaction(async (transaction) => {
    await installManagedRuntime({ ...runtimeOptions, transaction });
    const inspection = await inspectManagedRuntime(options.dataDir, options.identity);
    await validate?.(inspection);
    return inspection;
  });
}
