import { z } from 'zod';

export const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);

export const megaBrainConfigSchema = z.object({
  dataDir: z.string().min(1),
  logLevel: logLevelSchema.default('info'),
  allowEgress: z.boolean().default(false),
  allowLlm: z.boolean().default(false),
  agentMemory: z.object({
    mode: z.enum(['managed', 'remote']).default('managed'),
    baseUrl: z.url(),
    authToken: z.string().min(1).optional(),
    environment: z.record(z.string(), z.string()).default({}),
  }),
  codeReviewGraph: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    dataDir: z.string().min(1).optional(),
    environment: z.record(z.string(), z.string()).default({}),
  }),
  projects: z.record(z.string(), z.string()).default({}),
});

export type MegaBrainConfig = z.infer<typeof megaBrainConfigSchema>;
export type MegaBrainConfigInput = z.input<typeof megaBrainConfigSchema>;

export const DEFAULT_CONFIG = {
  logLevel: 'info',
  allowEgress: false,
  allowLlm: false,
  agentMemory: {
    mode: 'managed',
    baseUrl: 'http://127.0.0.1:3111',
    environment: {},
  },
  codeReviewGraph: {
    command: 'code-review-graph',
    args: [],
    environment: {},
  },
  projects: {},
} as const;
