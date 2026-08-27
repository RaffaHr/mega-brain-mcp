import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { dispatchHook } from '../../src/hooks/dispatcher.js';
import { normalizeHookEvent } from '../../src/hooks/events.js';
import { DurableHookQueue } from '../../src/hooks/queue.js';

describe('hook queue isolation and replay', () => {
  test('AC-063: eventos com falha podem ser reprocessados e has() diferencia status @spec:AC-063', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-queue-replay-'));
    const queuePath = join(root, 'hook-queue.json');
    const queue = new DurableHookQueue(queuePath);

    const payload = { tool: 'bash', idempotencyKey: 'test-event-1' };
    const event = normalizeHookEvent('claude', 'PostToolUseFailure', payload);

    // 1. Initial state: has() is false
    expect(await queue.has(event.key)).toBe(false);

    // 2. Enqueue failure: status becomes pending, attempts = 1
    const queued1 = await queue.enqueue(event, new Error('CRG timeout'));
    expect(queued1).toBe(true);

    // has() should still be FALSE because it was not successfully processed (allows replay/retry)
    expect(await queue.has(event.key)).toBe(false);

    const pendingList = await queue.pending();
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].attempts).toBe(1);
    expect(pendingList[0].lastError).toBe('CRG timeout');

    // 3. Retry execution fails again: increments attempts
    const queued2 = await queue.enqueue(event, new Error('CRG connection refused'));
    expect(queued2).toBe(true);
    expect((await queue.pending())[0].attempts).toBe(2);
    expect((await queue.pending())[0].lastError).toBe('CRG connection refused');

    // 4. Successful processing: markProcessed updates status to processed
    await queue.markProcessed(event);
    expect(await queue.has(event.key)).toBe(true);
    expect(await queue.pending()).toHaveLength(0);

    // 5. Subsequent dispatch recognizes it as duplicate
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

  test('concorrência: gravações paralelas não corrompem a fila nem causam lost update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-queue-concurrent-'));
    const queuePath = join(root, 'hook-queue.json');

    // Multiple queue instances pointing to the same file (simulating separate hook processes)
    const instances = Array.from({ length: 5 }, () => new DurableHookQueue(queuePath));

    const events = Array.from({ length: 15 }, (_, i) =>
      normalizeHookEvent('codex', 'PostToolUse', { index: i, idempotencyKey: `concurrent-event-${i}` }),
    );

    // Enqueue 15 events concurrently across 5 instances
    await Promise.all(
      events.map((event, i) => instances[i % instances.length].enqueue(event, new Error(`Err ${i}`))),
    );

    const pending = await instances[0].pending();
    expect(pending).toHaveLength(15);

    // Mark half of them processed concurrently
    await Promise.all(
      events.slice(0, 8).map((event, i) => instances[i % instances.length].markProcessed(event)),
    );

    expect(await instances[0].pending()).toHaveLength(7);
  });
});
