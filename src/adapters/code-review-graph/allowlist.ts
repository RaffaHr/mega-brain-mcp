export const CRG_READ_ONLY_TOOLS = [
  'get_minimal_context_tool',
  'query_graph_tool',
  'semantic_search_nodes_tool',
  'get_flow_tool',
  'get_affected_flows_tool',
  'detect_changes_tool',
  'get_impact_radius_tool',
  'get_architecture_overview_tool',
] as const;

export type CrgReadOnlyTool = (typeof CRG_READ_ONLY_TOOLS)[number];

const allowed = new Set<string>(CRG_READ_ONLY_TOOLS);

export function assertAllowedCrgTool(name: string): asserts name is CrgReadOnlyTool {
  if (!allowed.has(name)) throw new Error(`Code Review Graph tool is not allowed: ${name}`);
}

export function assertExactCrgSurface(names: string[]): void {
  const actual = [...names].sort();
  const expected = [...CRG_READ_ONLY_TOOLS].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`Code Review Graph exposed an incompatible tool surface: ${actual.join(',')}`);
  }
}
