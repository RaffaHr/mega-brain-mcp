import { z } from 'zod';

export const agentMemoryHealthSchema = z.object({
  status: z.string().optional(),
  healthy: z.boolean().optional(),
  version: z.string().optional(),
}).passthrough();

export const memoryRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  content: z.string().optional(),
  score: z.number().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const smartSearchResponseSchema = z.union([
  z.array(memoryRecordSchema).transform((results) => ({ results })),
  z.object({ results: z.array(memoryRecordSchema).default([]) }).passthrough(),
]);

export const rememberResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
}).passthrough();

export const genericAgentMemoryResponseSchema = z.record(z.string(), z.unknown());

export type AgentMemoryHealth = z.infer<typeof agentMemoryHealthSchema>;
export type SmartSearchResponse = z.infer<typeof smartSearchResponseSchema>;
