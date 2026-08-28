import { access, rm } from 'node:fs/promises';
import path from 'node:path';

import { projectConfigPath } from '../config/project-config.js';
import type { LocalLogger } from '../observability/logger.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { SupervisorIpcClient } from '../runtime/ipc.js';
import { runtimeLayout } from '../runtime/layout.js';
import { queuePendingDelete, safeRemoveDirectory } from '../runtime/pending-deletes.js';
import { sweepRuntimeProcesses, terminateProcessTree } from '../runtime/process-tree.js';
import { readSupervisorManifest, removeSupervisorManifest } from '../runtime/supervisor-manifest.js';
import { retryRename, snapshotFile, withRuntimeTransaction } from '../runtime/transaction.js';
import { stopManagedRuntime } from './stop.js';

export interface ReversibleUninstallParticipant {
  apply(): Promise<void>;
  rollback(): Promise<void>;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

function logUninstallStep(input: { identity: ProjectIdentity; logger?: LocalLogger }, message: string, fields: Record<string, unknown> = {}): void {
  input.logger?.log('info', `uninstall: ${message}`, { project: input.identity.worktreeId, ...fields });
}

export async function drainProjectSupervisor(input: {
  dataDir: string;
  identity: ProjectIdentity;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stopProcess?: (pid: number) => Promise<void>;
  stopRuntime?: () => Promise<void>;
}): Promise<void> {
  const layout = runtimeLayout(input.dataDir, input.identity);
  let manifest;
  try { manifest = await readSupervisorManifest(layout); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await (input.stopRuntime ?? (() => stopManagedRuntime(input.dataDir, input.identity)))();
      await sweepRuntimeProcesses(layout.runtimeRoot).catch(() => []);
      return;
    }
    throw error;
  }
  if (manifest.worktreeId !== input.identity.worktreeId) throw new Error('Cannot drain a supervisor owned by another worktree');
  const client = new SupervisorIpcClient(manifest);
  try {
    await client.drain();
    const deadline = Date.now() + (input.timeoutMs ?? 5_000);
    while ((await client.status()).leases.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 50));
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['ECONNREFUSED', 'ENOENT', 'EPIPE'].includes(code ?? '')) throw error;
  }
  await (input.stopProcess ?? (async (pid) => {
    await terminateProcessTree(pid);
  }))(manifest.pid);
  await (input.stopRuntime ?? (() => stopManagedRuntime(input.dataDir, input.identity)))();
  await removeSupervisorManifest(layout);
  await sweepRuntimeProcesses(layout.runtimeRoot).catch(() => []);
}

export async function uninstallMegaBrain(input: {
  dataDir: string;
  identity: ProjectIdentity;
  participants?: ReversibleUninstallParticipant[];
  purge?: boolean;
  drain?: () => Promise<void>;
  resume?: () => Promise<void>;
  logger?: LocalLogger;
}): Promise<{ dataPreserved: boolean }> {
  const layout = runtimeLayout(input.dataDir, input.identity);
  const quarantinedRuntime = path.join(layout.runtimeRoot, `.uninstall-${Date.now()}-${process.pid}`);
  const drain = input.drain ?? (() => drainProjectSupervisor({ dataDir: input.dataDir, identity: input.identity }));
  let drainAttempted = false;

  try {
    drainAttempted = true;
    logUninstallStep(input, 'draining project runtime');
    await drain();
    await sweepRuntimeProcesses(layout.runtimeRoot).catch(() => []);

    await withRuntimeTransaction(async (transaction) => {
      logUninstallStep(input, 'restoring host integrations');
      for (const participant of input.participants ?? []) {
        transaction.addRollback(() => participant.rollback());
        await participant.apply();
      }
      if (await exists(layout.current)) {
        logUninstallStep(input, 'quarantining runtime', { runtime: layout.current });
        let quarantined = false;
        try {
          await retryRename(layout.current, quarantinedRuntime, 'Quarantining current runtime for uninstall', { timeoutMs: 5_000 });
          quarantined = true;
          transaction.addRollback(() => retryRename(quarantinedRuntime, layout.current, 'Restoring current runtime after uninstall rollback'));
          transaction.addCommit(async () => {
            const removed = await safeRemoveDirectory(quarantinedRuntime);
            if (!removed) await queuePendingDelete(input.dataDir, quarantinedRuntime);
          });
        } catch {
          // If rename failed (e.g. anti-virus or handle holding the directory), try safe direct deletion
          const removed = await safeRemoveDirectory(layout.current);
          if (!removed) {
            await queuePendingDelete(input.dataDir, layout.current);
          }
        }
      }
      logUninstallStep(input, 'removing runtime state and project config');
      await snapshotFile(transaction, layout.stateFile);
      await rm(layout.stateFile, { force: true });
      const configPath = projectConfigPath(input.identity.root);
      await snapshotFile(transaction, configPath);
      await rm(configPath, { force: true });
    });
    logUninstallStep(input, 'integration cleanup complete', { dataPreserved: !input.purge });
  } catch (error) {
    if (drainAttempted && input.resume) {
      try { await input.resume(); }
      catch (resumeError) {
        throw new AggregateError([error, resumeError], 'Uninstall failed and the previous runtime could not be resumed');
      }
    }
    throw error;
  }

  if (input.purge) {
    logUninstallStep(input, 'purging project data', { projectRoot: layout.projectRoot });
    const removed = await safeRemoveDirectory(layout.projectRoot);
    if (!removed) {
      await queuePendingDelete(input.dataDir, layout.projectRoot);
    }
  }

  return { dataPreserved: !input.purge };
}