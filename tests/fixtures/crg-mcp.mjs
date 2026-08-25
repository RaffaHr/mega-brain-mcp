#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tools = [
  'get_minimal_context_tool',
  'query_graph_tool',
  'semantic_search_nodes_tool',
  'get_flow_tool',
  'get_affected_flows_tool',
  'detect_changes_tool',
  'get_impact_radius_tool',
  'get_architecture_overview_tool',
];

const server = new Server(
  { name: 'code-review-graph-fixture', version: '2.3.7' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((name) => ({ name, description: `Fixture ${name}`, inputSchema: { type: 'object', additionalProperties: true } })),
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const target = String(params.arguments?.target ?? params.arguments?.task ?? 'src/example.ts');
  const responses = {
    get_minimal_context_tool: { context: `Handler and dependency context for ${target}` },
    query_graph_tool: { tests: ['tests/example.test.ts'] },
    semantic_search_nodes_tool: { nodes: ['exampleHandler'] },
    get_flow_tool: { flow: ['request', 'handler', 'response'] },
    get_affected_flows_tool: { flows: ['example-request-flow'] },
    detect_changes_tool: { graphHead: process.env.CRG_FIXTURE_HEAD ?? null, changedFiles: [] },
    get_impact_radius_tool: { dependencies: ['src/example.ts'] },
    get_architecture_overview_tool: { modules: ['src/example.ts'], style: 'fixture' },
  };
  const structuredContent = responses[params.name] ?? { ok: true };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
});

await server.connect(new StdioServerTransport());
