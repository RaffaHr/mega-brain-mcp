import { normalizeHookEvent, type HookHost, type NormalizedHookEvent } from './events.js';
import type { DurableHookQueue } from './queue.js';

export interface HookDispatcherDependencies {
  queue: DurableHookQueue;
  redact(payload: Record<string, unknown>): Record<string, unknown>;
  capture(event: NormalizedHookEvent): Promise<void>;
  updateGraph(event: NormalizedHookEvent): Promise<void>;
}

export interface HookDispatchResult {
  continue: true;
  queued: boolean;
  duplicate: boolean;
}

export async function dispatchHook(
  host: HookHost,
  eventName: string,
  payload: Record<string, unknown>,
  dependencies: HookDispatcherDependencies,
): Promise<HookDispatchResult> {
  try {
    const event = normalizeHookEvent(host, eventName, dependencies.redact(payload));
    if (await dependencies.queue.has(event.key)) return { continue: true, queued: false, duplicate: true };
    try {
      await Promise.all([dependencies.capture(event), dependencies.updateGraph(event)]);
      await dependencies.queue.markProcessed(event);
      return { continue: true, queued: false, duplicate: false };
    } catch (error) {
      const queued = await dependencies.queue.enqueue(event, error);
      return { continue: true, queued, duplicate: !queued };
    }
  } catch {
    return { continue: true, queued: false, duplicate: false };
  }
}
