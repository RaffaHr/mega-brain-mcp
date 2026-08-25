import { z } from 'zod';

export const agentMemoryHealthSchema = z.object({
  status: z.string().optional(),
  healthy: z.boolean().optional(),
  version: z.string().optional(),
}).passthrough();

export const memoryRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  obsId: z.union([z.string(), z.number()]).transform(String).optional(),
  content: z.string().optional(),
  title: z.string().optional(),
  score: z.number().optional(),
  createdAt: z.string().optional(),
  timestamp: z.string().optional(),
  project: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const smartSearchResponseSchema = z.union([
  z.array(memoryRecordSchema).transform((results) => ({ results })),
  z.object({ results: z.array(memoryRecordSchema).default([]) }).passthrough(),
]);

export const expandedSmartSearchResponseSchema = z.object({
  mode: z.literal('expanded'),
  results: z.array(z.object({
    obsId: z.union([z.string(), z.number()]).transform(String),
    observation: z.object({
      id: z.union([z.string(), z.number()]).transform(String).optional(),
      title: z.string().optional(),
      narrative: z.string().optional(),
      facts: z.array(z.string()).optional(),
      timestamp: z.string().optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough().transform((response) => ({
  results: response.results.map(({ obsId, observation }) => ({
    id: observation.id ?? obsId,
    obsId,
    content: observation.narrative ?? observation.facts?.join('\n') ?? observation.title,
    title: observation.title,
    timestamp: observation.timestamp,
    createdAt: undefined,
    project: undefined,
    metadata: undefined,
  })),
}));

const memoryIdSchema = z.union([z.string(), z.number()]).transform(String);

export const rememberResponseSchema = z.union([
  z.object({ id: memoryIdSchema }).passthrough(),
  z.object({ memId: memoryIdSchema }).passthrough().transform((response) => ({ ...response, id: response.memId })),
  z.object({ memory: z.object({ id: memoryIdSchema }).passthrough() }).passthrough()
    .transform((response) => ({ ...response, id: response.memory.id })),
]);

export const memoriesResponseSchema = z.object({
  memories: z.array(memoryRecordSchema).default([]),
  total: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().nullable().optional(),
}).passthrough();

export const memoryByIdResponseSchema = z.object({ memory: memoryRecordSchema }).passthrough()
  .transform(({ memory }) => memory);

export const sessionsResponseSchema = z.object({
  sessions: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough();

export const genericAgentMemoryResponseSchema = z.record(z.string(), z.unknown());

export type AgentMemoryHealth = z.infer<typeof agentMemoryHealthSchema>;
export type SmartSearchResponse = z.infer<typeof smartSearchResponseSchema>;
