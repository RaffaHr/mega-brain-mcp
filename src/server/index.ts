import { MCPServer, object, type ToolDefinition } from 'mcp-use/server';
import { z } from 'zod';

import {
  createEnvelope,
  megaBrainEnvelopeSchema,
  type MegaBrainEnvelope,
} from './envelope.js';

export const PUBLIC_TOOL_NAMES = [
  'brain_recall',
  'brain_learn',
  'brain_change_context',
  'brain_history',
  'brain_validate',
  'brain_status',
] as const;

export type PublicToolName = (typeof PUBLIC_TOOL_NAMES)[number];
export type MegaBrainToolHandler = (
  input: Record<string, unknown>,
) => Promise<MegaBrainEnvelope>;
export type MegaBrainToolHandlers = Partial<Record<PublicToolName, MegaBrainToolHandler>>;

type PublicToolDefinition = ToolDefinition<Record<string, unknown>, MegaBrainEnvelope> & {
  name: PublicToolName;
};

const projectInput = {
  project: z.string().min(1).optional().describe('Registered project alias or checkout path'),
};

export const PUBLIC_TOOL_DEFINITIONS: readonly PublicToolDefinition[] = [
  {
    name: 'brain_recall',
    description: 'Recall project knowledge ranked by intent, freshness, and provenance.',
    schema: z.object({
      ...projectInput,
      query: z.string().min(1),
      intent: z.enum(['implementation', 'impact', 'history', 'decision', 'procedure', 'architecture', 'workflow', 'debugging']).optional(),
      budget: z.enum(['FAST', 'NORMAL', 'DEEP']).optional(),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'brain_learn',
    description: 'Store a project lesson with evidence and provenance.',
    schema: z.object({
      ...projectInput,
      statement: z.string().min(1),
      type: z.enum(['fact', 'decision', 'architecture', 'procedure', 'bug', 'rule', 'preference', 'experience']).optional(),
      evidence: z.array(z.object({
        path: z.string().min(1),
        blobHash: z.string().min(1).optional(),
        commitHash: z.string().min(1).optional(),
        symbol: z.string().min(1).optional(),
      })).optional(),
      supersedes: z.string().min(1).optional(),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'brain_change_context',
    description: 'Explain the structural and historical context of a project change.',
    schema: z.object({
      ...projectInput,
      target: z.string().min(1),
      budget: z.enum(['FAST', 'NORMAL', 'DEEP']).optional(),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'brain_history',
    description: 'Combine immutable Git history with relevant remembered experience.',
    schema: z.object({
      ...projectInput,
      query: z.string().min(1).optional(),
      start: z.iso.datetime().optional(),
      end: z.iso.datetime().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'brain_validate',
    description: 'Record a validation outcome without rewriting historical memory.',
    schema: z.object({
      ...projectInput,
      memoryId: z.string().min(1),
      outcome: z.enum(['confirmed', 'refuted', 'superseded']),
      evidence: z.array(z.string().min(1)).min(1),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'brain_status',
    description: 'Report local backend health, freshness, queues, and compatibility.',
    schema: z.object({
      ...projectInput,
      verbose: z.boolean().optional(),
    }),
    outputSchema: megaBrainEnvelopeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
];

function unavailableHandler(name: PublicToolName): MegaBrainToolHandler {
  return async () =>
    createEnvelope(
      { available: false, tool: name },
      {
        status: 'degraded',
        warnings: [`${name} is registered but its v1 backend is not configured yet`],
      },
    );
}

export function createMegaBrainServer(handlers: MegaBrainToolHandlers = {}) {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const server = new MCPServer({
    name: 'mega-brain-mcp',
    version: '0.1.6',
    description: 'Evidence-aware orchestration for AgentMemory, Code Review Graph, and Git.',
    instructions: 'Use only the six public brain_* tools. Backend tools are private implementation details.',
    stateless: true,
  });

  for (const definition of PUBLIC_TOOL_DEFINITIONS) {
    const handler = handlers[definition.name] ?? unavailableHandler(definition.name);
    server.tool(definition, async (input) => object(await handler(input)));
  }

  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  return server;
}

export async function listenMegaBrainServer(server: ReturnType<typeof createMegaBrainServer>, port: number): Promise<void> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHost = process.env.HOST;
  process.env.NODE_ENV = 'production';
  process.env.HOST = '127.0.0.1';
  try { await server.listen(port); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
  }
}

const server = createMegaBrainServer();

export default server;
