import { access, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { projectConfigPath } from '../config/project-config.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { SupervisorIpcClient } from '../runtime/ipc.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readSupervisorManifest, removeSupervisorManifest } from '../runtime/supervisor-manifest.js';
import { snapshotFile, withRuntimeTransaction } from '../runtime/transaction.js';
import { stopManagedRuntime } from './stop.js';

export interface ReversibleUninstallParticipant {
  apply(): Promise<void>;
  rollback(): Promise<void>;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
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
      return;
    }
    throw error;
  }
  if (manifest.worktreeId !== input.identity.worktreeId) throw new Error('Cannot drain a supervisor owned by another worktree');
  const client = new SupervisorIpcClient(manifest);
  await client.drain();
  const deadline = Date.now() + (input.timeoutMs ?? 5_000);
  while ((await client.status()).leases.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 50));
  }
  await (input.stopProcess ?? (async (pid) => {
    try { process.kill(pid, 'SIGTERM'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }))(manifest.pid);
  await (input.stopRuntime ?? (() => stopManagedRuntime(input.dataDir, input.identity)))();
  await removeSupervisorManifest(layout);
}

export async function uninstallMegaBrain(input: {
  dataDir: string;
  identity: ProjectIdentity;
  participants?: ReversibleUninstallParticipant[];
  purge?: boolean;
  drain?: () => Promise<void>;
  resume?: () => Promise<void>;
}): Promise<{ dataPreserved: boolean }> {
  const layout = runtimeLayout(input.dataDir, input.identity);
  const quarantinedRuntime = path.join(layout.runtimeRoot, `.uninstall-${Date.now()}-${process.pid}`);
  const drain = input.drain ?? (() => drainProjectSupervisor({ dataDir: input.dataDir, identity: input.identity }));
  let drainAttempted = false;
  try {
    drainAttempted = true;
    await drain();
    await withRuntimeTransaction(async (transaction) => {
      for (const participant of input.participants ?? []) {
        transaction.addRollback(() => participant.rollback());
        await participant.apply();
      }
      if (await exists(layout.current)) {
        await rename(layout.current, quarantinedRuntime);
        transaction.addRollback(() => rename(quarantinedRuntime, layout.current));
        transaction.addCommit(() => rm(quarantinedRuntime, { recursive: true, force: true }));
      }
      await snapshotFile(transaction, layout.stateFile);
      await rm(layout.stateFile, { force: true });
      const configPath = projectConfigPath(input.identity.root);
      await snapshotFile(transaction, configPath);
      await rm(configPath, { force: true });
    });
  } catch (error) {
    if (drainAttempted && input.resume) {
      try { await input.resume(); }
      catch (resumeError) {
        throw new AggregateError([error, resumeError], 'Uninstall failed and the previous runtime could not be resumed');
      }
    }
    throw error;
  }
  if (input.purge) await rm(layout.projectRoot, { recursive: true, force: true });
  return { dataPreserved: !input.purge };
}
