import { expect, test, vi } from 'vitest';

import { CRG_READ_ONLY_TOOLS } from '../../src/adapters/code-review-graph/allowlist.js';
import { CodeReviewGraphClient, type CrgSession } from '../../src/adapters/code-review-graph/client.js';

function fakeSession(callTool = vi.fn(async () => ({ content: [], structuredContent: { ok: true } }))): CrgSession {
  return {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: CRG_READ_ONLY_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })),
    })),
    callTool,
    close: vi.fn(async () => undefined),
  };
}

test('keeps one private CRG session and exposes only the read-only allowlist', async () => {
  const session = fakeSession();
  const factory = vi.fn(() => session);
  const client = new CodeReviewGraphClient({ command: 'code-review-graph', cwd: '.', sessionFactory: factory });

  await client.start();
  await client.call('get_minimal_context_tool', { task: 'review auth' });
  await client.call('query_graph_tool', { pattern: 'callers_of', target: 'login' });

  expect(factory).toHaveBeenCalledTimes(1);
  expect(session.callTool).toHaveBeenCalledTimes(2);
  await expect(client.call('build_or_update_graph_tool' as never, {})).rejects.toThrow(/not allowed/);
});

test('rejects an expanded surface and restarts once after a transport failure', async () => {
  const expanded = fakeSession();
  expanded.listTools = vi.fn(async () => ({
    tools: [...CRG_READ_ONLY_TOOLS, 'apply_refactor_tool'].map((name) => ({ name, inputSchema: { type: 'object' } })),
  }));
  const rejected = new CodeReviewGraphClient({ command: 'crg', cwd: '.', sessionFactory: () => expanded });
  await expect(rejected.start()).rejects.toThrow(/incompatible tool surface/);

  const first = fakeSession(vi.fn(async () => { throw new Error('broken pipe'); }));
  const second = fakeSession();
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const recovered = new CodeReviewGraphClient({ command: 'crg', cwd: '.', sessionFactory: factory });
  await expect(recovered.call('get_impact_radius_tool', { changed_files: ['src/a.ts'] })).resolves.toMatchObject({
    structuredContent: { ok: true },
  });
  expect(factory).toHaveBeenCalledTimes(2);
});
