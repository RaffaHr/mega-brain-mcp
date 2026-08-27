import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

import { handleGitHook } from '../../src/cli/hook.js';
import type { MegaBrainConfig } from '../../src/config/schema.js';
import type { ProjectIdentity } from '../../src/projects/identity.js';

const execFileAsync = promisify(execFile);

// US-022 — Segurança e integridade de hooks e fila
test('AC-062: Redação obrigatória em payloads de hooks git @spec:AC-062', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mega-brain-git-redact-spec-'));
  await execFileAsync('git', ['init', root]);

  const config = {
    dataDir: root,
    port: 3000,
    logLevel: 'info',
    allowEgress: false,
    allowLlm: false,
    agentMemory: { mode: 'managed', baseUrl: 'http://127.0.0.1:3111' },
    codeReviewGraph: { command: 'code-review-graph', args: [] },
    environment: {},
    projects: {},
  } as unknown as MegaBrainConfig;

  const identity: ProjectIdentity = {
    root,
    gitDir: join(root, '.git'),
    commonGitDir: join(root, '.git'),
    repositoryId: 'repo-spec',
    checkoutId: 'checkout-spec',
    worktreeId: 'worktree-spec',
  };

  const secretToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  const secretAuth = 'Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';

  const result = await handleGitHook({
    event: 'post-commit',
    config,
    identity,
    hookArgs: ['--token', secretToken],
    stdin: `commit message with ${secretAuth}`,
  });

  expect(result.duplicate).toBe(false);
  expect(result.queued).toBe(true);

  const queueFile = join(root, 'projects', 'worktree-spec', 'hook-queue.json');
  const content = await readFile(queueFile, 'utf8');
  const queue = JSON.parse(content) as Array<{ event: { payload: { hookArgs: string[]; stdin: string } } }>;

  expect(queue).toHaveLength(1);
  const queuedPayload = queue[0].event.payload;
  expect(queuedPayload.hookArgs.join(' ')).not.toContain(secretToken);
  expect(queuedPayload.hookArgs.join(' ')).toContain('[REDACTED]');
  expect(queuedPayload.stdin).not.toContain('sk-ant-api03');
  expect(queuedPayload.stdin).toContain('[REDACTED]');
});

import { dispatchHook } from '../../src/hooks/dispatcher.js';
import { normalizeHookEvent } from '../../src/hooks/events.js';
import { DurableHookQueue } from '../../src/hooks/queue.js';

// US-022 — Segurança e integridade de hooks e fila
test('AC-063: Fila durável com isolamento concorrente e replay de falhas @spec:AC-063', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mega-brain-queue-replay-spec-'));
  const queuePath = join(root, 'hook-queue.json');
  const queue = new DurableHookQueue(queuePath);

  const payload = { tool: 'bash', idempotencyKey: 'test-event-spec' };
  const event = normalizeHookEvent('claude', 'PostToolUseFailure', payload);

  expect(await queue.has(event.key)).toBe(false);

  await queue.enqueue(event, new Error('CRG timeout'));
  expect(await queue.has(event.key)).toBe(false);

  const pendingList = await queue.pending();
  expect(pendingList).toHaveLength(1);
  expect(pendingList[0].attempts).toBe(1);

  await queue.markProcessed(event);
  expect(await queue.has(event.key)).toBe(true);
  expect(await queue.pending()).toHaveLength(0);

  let captureCalled = 0;
  const dependencies = {
    queue,
    redact: (p: Record<string, unknown>) => p,
    capture: async () => { captureCalled++; },
    updateGraph: async () => undefined,
  };

  const dispatchResult = await dispatchHook('claude', 'PostToolUseFailure', payload, dependencies);
  expect(dispatchResult.duplicate).toBe(true);
  expect(captureCalled).toBe(0);
});

import { openProvenanceDatabase } from '../../src/provenance/database.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';

// US-023 — Concorrência de banco e integridade de evidências
test('AC-064: Deduplicação de evidências com símbolo ausente via migration v2 @spec:AC-064', () => {
  const database = openProvenanceDatabase(':memory:');
  const repository = new ProvenanceRepository(database);
  repository.registerProject({ id: 'proj-spec', checkoutId: 'co-spec', worktreeId: 'wt-spec', root: '/repo' });

  repository.saveMemoryReference({
    memoryId: 'mem-no-symbol-spec',
    projectId: 'proj-spec',
    state: 'FRESH',
    confidence: 1,
    evidence: [
      { path: 'src/main.ts', blobHash: 'blob-aaa', commitHash: 'commit-111' },
    ],
  });

  const rows1 = database.prepare('SELECT COUNT(*) as count FROM evidence WHERE memory_id = ?').get('mem-no-symbol-spec') as { count: number };
  expect(rows1.count).toBe(1);

  repository.saveMemoryReference({
    memoryId: 'mem-no-symbol-spec',
    projectId: 'proj-spec',
    state: 'FRESH',
    confidence: 1,
    evidence: [
      { path: 'src/main.ts', blobHash: 'blob-aaa', commitHash: 'commit-111' },
    ],
  });

  const rows2 = database.prepare('SELECT COUNT(*) as count FROM evidence WHERE memory_id = ?').get('mem-no-symbol-spec') as { count: number };
  expect(rows2.count).toBe(1);
  database.close();
});

// US-023 — Concorrência de banco e integridade de evidências
test('AC-065: Configuração de busy_timeout em todos os backends SQLite @spec:AC-065', () => {
  const db1 = openProvenanceDatabase(':memory:');
  const timeout1 = db1.pragma('busy_timeout', { simple: true });
  expect(Number(timeout1)).toBe(5000);
  db1.close();

  const previous = process.env.MEGA_BRAIN_SQLITE_BACKEND;
  process.env.MEGA_BRAIN_SQLITE_BACKEND = 'node';
  try {
    const db2 = openProvenanceDatabase(':memory:');
    const timeout2 = db2.pragma('busy_timeout', { simple: true });
    expect(Number(timeout2)).toBe(5000);
    db2.close();
  } finally {
    if (previous === undefined) delete process.env.MEGA_BRAIN_SQLITE_BACKEND;
    else process.env.MEGA_BRAIN_SQLITE_BACKEND = previous;
  }
});

import { buildChangeContext } from '../../src/orchestration/change-context.js';

// US-024 — Qualidade de ranking e concorrência no recall
test('AC-066: Eliminação do viés fixo contra AgentMemory em change-context @spec:AC-066', async () => {
  const result = await buildChangeContext(
    { target: 'src/checkout.ts', budget: 'FAST' },
    {
      structure: async () => ({
        dependencies: ['src/payment.ts', 'src/user.ts'],
        flows: ['checkout-flow', 'payment-flow'],
        tests: ['tests/checkout.test.ts'],
      }),
      experience: async () => ({
        rules: ['Rule: never mutate order in-flight without locking'],
        bugs: ['Bug: race condition when payment times out'],
        decisions: ['Decision: use idempotent key for third party gateway'],
        risks: ['Risk: double charge if webhook retries concurrently'],
      }),
      maxTokenBudget: 500,
    },
  );

  expect(result.context).toContain('Rules:');
  expect(result.context).toContain('never mutate order in-flight without locking');
  expect(result.context).toContain('Bugs:');
  expect(result.context).toContain('race condition when payment times out');
});

import { vi } from 'vitest';
import { brainRecall, type RecallSourceAdapter } from '../../src/tools/brain-recall.js';
import { LocalMetrics } from '../../src/observability/metrics.js';
import type { EvidenceChunk } from '../../src/orchestration/ranking.js';
import { GitRepository } from '../../src/adapters/git/repository.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

function makeChunk(source: EvidenceChunk['source'], id: string, text = 'evidence'): EvidenceChunk {
  return {
    id,
    source,
    text,
    retrieval: 1,
    intentFit: 1,
    freshness: 1,
    confidence: 1,
    provenance: 1,
    reinforcement: 1,
    reference: `${source}:${id}`,
  };
}

// US-024 — Qualidade de ranking e concorrência no recall
test('AC-067: Consulta paralela a fontes com isolamento de falhas em brain-recall @spec:AC-067', async () => {
  const resolvedOrder: string[] = [];

  const slowAdapter: RecallSourceAdapter = {
    recall: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      resolvedOrder.push('slow-crg');
      return [makeChunk('code_review_graph', 'crg-1')];
    }),
  };

  const fastAdapter: RecallSourceAdapter = {
    recall: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      resolvedOrder.push('fast-memory');
      return [makeChunk('agentmemory', 'mem-1')];
    }),
  };

  const failingAdapter: RecallSourceAdapter = {
    recall: vi.fn(async () => {
      throw new Error('Git repository error');
    }),
  };

  const result = await brainRecall(
    { query: 'Why did login fail?', intent: 'debugging' },
    {
      sources: {
        code_review_graph: slowAdapter,
        agentmemory: fastAdapter,
        git: failingAdapter,
      },
      project: 'test-project',
      head: 'commit-123',
    },
  );

  expect(resolvedOrder).toEqual(['fast-memory', 'slow-crg']);
  expect(result.status).toBe('degraded');
  expect(result.warnings).toContain('git unavailable');
  expect(result.result.context).toContain('[agentmemory]');
  expect(result.result.context).toContain('[code_review_graph]');
});

// US-025 — Observabilidade de recall e parsing seguro de git status
test('AC-068: Instrumentação de métricas no caminho de recall @spec:AC-068', async () => {
  const metrics = new LocalMetrics();

  const memAdapter: RecallSourceAdapter = {
    recall: vi.fn(async () => [
      makeChunk('agentmemory', 'm1', 'large rule text '.repeat(50)),
      makeChunk('agentmemory', 'm2', 'large bug text '.repeat(50)),
      makeChunk('agentmemory', 'm3', 'large decision text '.repeat(50)),
    ]),
  };

  const crgAdapter: RecallSourceAdapter = {
    recall: vi.fn(async () => [makeChunk('code_review_graph', 'c1', 'dependency context')]),
  };

  await brainRecall(
    { query: 'test query', budget: 'FAST' },
    {
      sources: {
        agentmemory: memAdapter,
        code_review_graph: crgAdapter,
      },
      project: 'test-project',
      head: 'commit-123',
      maxTokenBudget: 200,
      metrics,
    },
  );

  const snapshot = metrics.snapshot();
  expect(snapshot.gauges['recall_latency_agentmemory']).toBeDefined();
  expect(snapshot.gauges['recall_latency_code_review_graph']).toBeDefined();
  expect(snapshot.counters['chunks_total']).toBe(4);
  expect(snapshot.counters['chunks_included']).toBeGreaterThan(0);
  expect(snapshot.counters['chunks_dropped']).toBeGreaterThan(0);
});

// US-025 — Observabilidade de recall e parsing seguro de git status
test('AC-069: Suporte a rename no parser de git status @spec:AC-069', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-git-rename-spec-'));
  await execFileAsync('git', ['init', root]);
  await writeFile(path.join(root, 'old-name.ts'), 'export const hello = "world";\n', 'utf8');
  await writeFile(path.join(root, 'stay.ts'), 'export const unchanged = true;\n', 'utf8');
  await execFileAsync('git', ['-C', root, 'add', '.']);
  await execFileAsync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'initial']);

  await execFileAsync('git', ['-C', root, 'mv', 'old-name.ts', 'new-name.ts']);
  await writeFile(path.join(root, 'stay.ts'), 'export const unchanged = false;\n', 'utf8');

  const repository = await GitRepository.discover(root);
  const status = await repository.status();

  const renameEntry = status.find((e) => e.path === 'new-name.ts');
  expect(renameEntry).toBeDefined();
  expect(renameEntry?.index).toBe('R');
  expect(renameEntry?.origPath).toBe('old-name.ts');

  const modEntry = status.find((e) => e.path === 'stay.ts');
  expect(modEntry).toBeDefined();
  expect(modEntry?.worktree).toBe('M');
});
