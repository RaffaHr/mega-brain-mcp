import { z } from 'zod';

export const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);
export const tcpPortSchema = z.number().int().min(1).max(65_535);

export const agentMemoryPortsSchema = z.object({
  rest: tcpPortSchema.default(3111),
  streams: tcpPortSchema.default(3112),
  viewer: tcpPortSchema.default(3113),
  engine: tcpPortSchema.default(3114),
});

export const megaBrainConfigSchema = z.object({
  dataDir: z.string().min(1),
  port: tcpPortSchema.default(3000),
  logLevel: logLevelSchema.default('info'),
  allowEgress: z.boolean().default(false),
  allowLlm: z.boolean().default(false),
  agentMemory: z.object({
    mode: z.enum(['managed', 'remote']).default('managed'),
    baseUrl: z.url(),
    secretEnvVar: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u).optional(),
    authToken: z.string().min(1).optional(),
    ports: agentMemoryPortsSchema.default({ rest: 3111, streams: 3112, viewer: 3113, engine: 3114 }),
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
  port: 3000,
  logLevel: 'info',
  allowEgress: false,
  allowLlm: false,
  agentMemory: {
    mode: 'managed',
    baseUrl: 'http://127.0.0.1:3111',
    ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
    environment: {},
  },
  codeReviewGraph: {
    command: 'code-review-graph',
    args: [],
    environment: {},
  },
  projects: {},
} as const;
