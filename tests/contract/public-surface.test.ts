import { expect, test } from 'vitest';

import {
  createMegaBrainServer,
  PUBLIC_TOOL_DEFINITIONS,
  PUBLIC_TOOL_NAMES,
} from '../../src/server/index.js';

test('AC-002: o host enxerga somente as seis tools do Mega Brain @spec:AC-002', () => {
  const server = createMegaBrainServer();

  expect(server.registeredTools).toEqual(PUBLIC_TOOL_NAMES);
  expect(PUBLIC_TOOL_DEFINITIONS).toHaveLength(6);
  expect(new Set(PUBLIC_TOOL_NAMES).size).toBe(6);
});

test('P-004: tools públicas de consulta não alteram o repositório @principle:P-004', () => {
  const queryTools = PUBLIC_TOOL_DEFINITIONS.filter(({ name }) =>
    ['brain_recall', 'brain_change_context', 'brain_history', 'brain_status'].includes(name),
  );

  expect(queryTools).toHaveLength(4);
  expect(queryTools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true);
  expect(queryTools.every(({ annotations }) => annotations?.destructiveHint === false)).toBe(true);
});

test('P-005: backends permanecem privados e com privilégio mínimo @principle:P-005', () => {
  const server = createMegaBrainServer();

  expect(server.registeredTools).not.toContain('semantic_search_nodes');
  expect(server.registeredTools).not.toContain('search_memory');
  expect(server.registeredTools.every((name) => name.startsWith('brain_'))).toBe(true);
});
