import type { z } from 'zod';

import type { agentMemoryModeSchema, runtimeCommandSchema } from './lock-manifest.js';

export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;
export type AgentMemoryMode = z.infer<typeof agentMemoryModeSchema>;
export type RuntimeBackendName = 'agentMemory' | 'codeReviewGraph';
export type RuntimeEnvironment = Partial<Record<RuntimeBackendName, Record<string, string>>>;
