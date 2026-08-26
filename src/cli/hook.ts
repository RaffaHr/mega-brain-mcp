import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { GitRepository, NO_GIT_HEAD } from '../adapters/git/repository.js';
import type { MegaBrainConfig } from '../config/schema.js';
import { dispatchHook } from '../hooks/dispatcher.js';
import type { HookHost, NormalizedHookEvent } from '../hooks/events.js';
import type { MegaBrainGitHook } from '../hooks/git/multiplexer.js';
import { DurableHookQueue } from '../hooks/queue.js';
import { handleGitEvent, HookEventLedger } from '../lifecycle/commit-handler.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { openProvenanceDatabase } from '../provenance/database.js';
import { ProvenanceRepository } from '../provenance/repository.js';
import { runtimeLayout } from '../runtime/layout.js';
import { redactRecord } from '../security/redaction.js';
import { inspectManagedRuntime } from './install.js';

const execFileAsync = promisify(execFile);

async function crgUpdate(config: MegaBrainConfig, identity: ProjectIdentity): Promise<void> {
  const inspection = await inspectManagedRuntime(config.dataDir, identity);
  const runtime = inspection.manifest.backends.codeReviewGraph;
  const args = runtime.args.includes('serve')
    ? runtime.args.map((argument) => argument === 'serve' ? 'update' : argument)
    : [...runtime.args, 'update'];
  await execFileAsync(runtime.command, args, { cwd: identity.root, windowsHide: true, encoding: 'utf8' });
}

export async function handleHostHook(input: {
  host: HookHost;
  payload: Record<string, unknown>;
  config: MegaBrainConfig;
  identity: ProjectIdentity;
}): Promise<{ continue: true; queued: boolean; duplicate: boolean }> {
  const eventName = String(input.payload.hook_event_name ?? input.payload.hookEventName ?? '');
  const layout = runtimeLayout(input.config.dataDir, input.identity);
  const queue = new DurableHookQueue(path.join(layout.projectRoot, 'hook-queue.json'));
  const agentMemory = new AgentMemoryClient({
    baseUrl: input.config.agentMemory.baseUrl,
    ...(input.config.agentMemory.authToken ? { authToken: input.config.agentMemory.authToken } : {}),
  });
  return dispatchHook(input.host, eventName, input.payload, {
    queue,
    redact: redactRecord,
    async capture(event: NormalizedHookEvent) {
      await agentMemory.remember({
        content: `${event.host}:${event.event}`,
        metadata: { eventKey: event.key, occurredAt: event.occurredAt, payload: event.payload },
      });
    },
    async updateGraph(event) {
      if (event.event === 'tool_succeeded' || event.event === 'tool_failed' || event.event === 'stopped') {
        await crgUpdate(input.config, input.identity);
      }
    },
  });
}

export async function handleGitHook(input: {
  event: MegaBrainGitHook;
  config: MegaBrainConfig;
  identity: ProjectIdentity;
  hookArgs?: string[];
  stdin?: string;
}): Promise<{ duplicate: boolean; queued?: boolean }> {
  const repository = await GitRepository.discover(input.identity.root);
  const head = await repository.head();
  const layout = runtimeLayout(input.config.dataDir, input.identity);
  const database = openProvenanceDatabase(path.join(layout.projectRoot, 'provenance.sqlite'));
  const provenance = new ProvenanceRepository(database);
  const queue = new DurableHookQueue(path.join(layout.projectRoot, 'hook-queue.json'));
  const agentMemory = new AgentMemoryClient({
    baseUrl: input.config.agentMemory.baseUrl,
    ...(input.config.agentMemory.authToken ? { authToken: input.config.agentMemory.authToken } : {}),
  });
  const fingerprint = createHash('sha256').update(JSON.stringify({ event: input.event, head, args: input.hookArgs ?? [], stdin: input.stdin ?? '' })).digest('hex');
  try {
    return await handleGitEvent({ key: `${input.event}:${fingerprint}`, event: input.event, commitHash: head }, {
      ledger: new HookEventLedger(database),
      changedPaths: async () => {
        if (head === NO_GIT_HEAD) return [];
        if (input.event === 'post-checkout' && input.hookArgs?.[0] && input.hookArgs[1]) {
          return (await repository.run(['diff', '--name-only', input.hookArgs[0], input.hookArgs[1]])).split(/\r?\n/).filter(Boolean);
        }
        return (await repository.run(['diff-tree', '--no-commit-id', '--name-only', '-r', head])).split(/\r?\n/).filter(Boolean);
      },
      updateGraph: () => crgUpdate(input.config, input.identity),
      linkSession: async (commitHash) => { await agentMemory.remember({ content: `Git commit ${commitHash}`, metadata: { commitHash, event: input.event } }); },
      revalidation: {
        findAffectedMemoryIds: async (paths) => provenance.memoryIdsForPaths(paths),
        findBlastRadius: async () => [],
        markPossiblyStale: async (memoryId, reason) => provenance.updateState(memoryId, 'POSSIBLY_STALE', 0.45, reason),
      },
    }).catch(async (error) => {
      const queued = await queue.enqueue({
        key: `${input.event}:${fingerprint}`,
        host: 'git',
        event: 'git_changed',
        occurredAt: new Date().toISOString(),
        payload: { event: input.event, head, hookArgs: input.hookArgs ?? [], stdin: input.stdin ?? '' },
      }, error);
      return { duplicate: false, queued };
    });
  } finally {
    database.close();
  }
}
