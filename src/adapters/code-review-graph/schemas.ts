import { z } from 'zod';

export const crgToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
}).passthrough();

export const crgToolsResponseSchema = z.object({ tools: z.array(crgToolSchema) }).passthrough();

export const crgToolResultSchema = z.object({
  content: z.array(z.record(z.string(), z.unknown())).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
}).passthrough();

export type CrgToolResult = z.infer<typeof crgToolResultSchema>;
