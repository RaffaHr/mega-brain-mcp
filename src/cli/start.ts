import path from 'node:path';

import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { readRuntimeLock } from '../runtime/lock-manifest.js';
import { startRuntime, type ProcessController, type RuntimeState } from '../runtime/supervisor.js';
import type { AgentMemoryMode } from '../runtime/types.js';

export interface StartManagedRuntimeOptions {
  agentMemoryMode?: AgentMemoryMode;
  agentMemoryEnvironment?: Record<string, string>;
  controller?: ProcessController;
  ready?: () => Promise<void>;
}

export async function startManagedRuntime(
  dataDir: string,
  identity: ProjectIdentity,
  options: StartManagedRuntimeOptions = {},
): Promise<RuntimeState> {
  const layout = runtimeLayout(dataDir, identity);
  const manifest = await readRuntimeLock(path.join(layout.current, 'runtime-lock.json'));
  const agentMemoryMode = options.agentMemoryMode ?? manifest.agentMemoryMode;
  return startRuntime(layout, manifest, options.controller, {
    agentMemoryMode,
    environment: agentMemoryMode === 'managed' && options.agentMemoryEnvironment
      ? { agentMemory: options.agentMemoryEnvironment }
      : {},
    ...(options.ready ? { ready: options.ready } : {}),
  });
}



export async function waitForService(
  check: () => Promise<unknown>,
  options: { timeoutMs?: number; intervalMs?: number; consecutiveSuccesses?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 250;
  const requiredSuccesses = options.consecutiveSuccesses ?? 1;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let successes = 0;
  do {
    try {
      await check();
      successes += 1;
      if (successes >= requiredSuccesses) return;
      lastError = new Error(`service passed only ${successes}/${requiredSuccesses} consecutive probes`);
    } catch (error) {
      successes = 0;
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`Service did not become ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
