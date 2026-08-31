import { z } from 'zod';

export const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);
export const tcpPortSchema = z.number().int().min(1).max(65_535);

export const configurationSourceSchema = z.enum(['default', 'user', 'existing', 'inferred']);
export const configurationStatusSchema = z.enum(['applied', 'unset', 'skipped', 'configured']);
export const projectConfigMetadataSchema = z.object({
  sources: z.record(z.string(), configurationSourceSchema).default({}),
  status: z.record(z.string(), configurationStatusSchema).default({}),
  consents: z.object({
    allowEgress: z.boolean().optional(),
    allowLlm: z.boolean().optional(),
    cloudProviders: z.array(z.string()).default([]),
    customVersions: z.record(z.string(), z.string()).default({}),
  }).default({ cloudProviders: [], customVersions: {} }),
});

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
    authToken: z.string().min(1).optional(),
    ports: agentMemoryPortsSchema.default({ rest: 3111, streams: 3112, viewer: 3113, engine: 3114 }),
    environment: z.record(z.string(), z.string()).default({}),
  }).superRefine((agentMemory, context) => {
    if (agentMemory.mode === 'remote' && !agentMemory.authToken) {
      context.addIssue({ code: 'custom', path: ['authToken'], message: 'Remote AgentMemory mode requires MEGA_BRAIN_AGENTMEMORY_TOKEN or repository-local authToken' });
    }
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
export type ProjectConfigMetadata = z.infer<typeof projectConfigMetadataSchema>;

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
} satisfies Omit<MegaBrainConfigInput, 'dataDir'>;
