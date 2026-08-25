export interface ProjectLeaseClient {
  acquire(leaseId: string): Promise<void>;
  heartbeat(leaseId: string): Promise<void>;
  release(leaseId: string): Promise<void>;
}

export async function withProjectLease<T>(
  client: ProjectLeaseClient,
  leaseId: string,
  run: () => Promise<T>,
  heartbeatMs = 10_000,
): Promise<T> {
  await client.acquire(leaseId);
  let rejectHeartbeat!: (error: unknown) => void;
  const heartbeatFailure = new Promise<never>((_resolve, reject) => { rejectHeartbeat = reject; });
  const timer = setInterval(() => {
    void client.heartbeat(leaseId).catch(rejectHeartbeat);
  }, heartbeatMs);
  timer.unref();
  try {
    return await Promise.race([run(), heartbeatFailure]);
  } finally {
    clearInterval(timer);
    await client.release(leaseId);
  }
}

export async function runMcpCommand(input: {
  config: MegaBrainConfig;
  identity: ProjectIdentity;
  streams?: { input?: Readable; output?: Writable };
}): Promise<void> {
  const layout = runtimeLayout(input.config.dataDir, input.identity);
  const supervisor = await ensureProjectSupervisor({ layout, identity: input.identity, timeoutMs: 60_000 });
  await withProjectLease(supervisor.client, randomUUID(), async () => {
    const inspection = await inspectManagedRuntime(input.config.dataDir, input.identity);
    const command = inspection.manifest.backends.codeReviewGraph;
    const dataDir = command.environment?.CRG_DATA_DIR ?? input.config.codeReviewGraph.dataDir;
    const git = await GitRepository.discover(input.identity.root);
    const agentMemory = new AgentMemoryClient({
      baseUrl: input.config.agentMemory.mode === 'managed' && inspection.manifest.isolation
        ? `http://127.0.0.1:${inspection.manifest.isolation.ports.rest}`
        : input.config.agentMemory.baseUrl,
      ...(input.config.agentMemory.authToken ? { authToken: input.config.agentMemory.authToken } : {}),
    });
    const codeReviewGraph = new CodeReviewGraphClient({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      environment: { ...command.environment, ...input.config.codeReviewGraph.environment },
      repoRoot: command.environment?.CRG_REPO_ROOT ?? input.identity.root,
      ...(dataDir ? { dataDir } : {}),
    });
    const provenancePath = inspection.manifest.isolation?.paths.provenance
      ?? path.join(layout.projectRoot, 'provenance.sqlite');
    const database = openProvenanceDatabase(provenancePath);
    const server = createMegaBrainServer(createApplicationHandlers({
      config: input.config,
      identity: input.identity,
      git,
      agentMemory,
      codeReviewGraph,
      provenance: new ProvenanceRepository(database),
    }));
    const session = await listenMegaBrainStdio(server, input.streams);
    const close = () => { void session.close(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    try {
      await session.closed;
    } finally {
      process.off('SIGINT', close);
      process.off('SIGTERM', close);
      await session.close();
      await codeReviewGraph.stop().catch(() => undefined);
      database.close();
    }
  });
}
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { AgentMemoryClient } from '../adapters/agentmemory/client.js';
import { CodeReviewGraphClient } from '../adapters/code-review-graph/client.js';
import { GitRepository } from '../adapters/git/repository.js';
import type { MegaBrainConfig } from '../config/schema.js';
import type { ProjectIdentity } from '../projects/identity.js';
import { openProvenanceDatabase } from '../provenance/database.js';
import { ProvenanceRepository } from '../provenance/repository.js';
import { ensureProjectSupervisor } from '../runtime/project-supervisor.js';
import { runtimeLayout } from '../runtime/layout.js';
import { createApplicationHandlers } from '../server/application.js';
import { createMegaBrainServer } from '../server/index.js';
import { listenMegaBrainStdio } from '../server/stdio.js';
import { inspectManagedRuntime } from './install.js';
