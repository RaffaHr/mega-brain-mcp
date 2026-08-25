import { PassThrough } from 'node:stream';

import { afterEach, expect, test, vi } from 'vitest';

import { withProjectLease } from '../../src/cli/mcp.js';
import { PUBLIC_TOOL_NAMES, createMegaBrainServer } from '../../src/server/index.js';
import { listenMegaBrainStdio } from '../../src/server/stdio.js';

async function responseLine(output: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      output.off('data', onData);
      try { resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>); }
      catch (error) { reject(error); }
    };
    output.on('data', onData);
  });
}

afterEach(() => vi.useRealTimers());

test('AC-039: MCP stdio responde initialize e expõe somente as seis brain tools @spec:AC-039', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const session = await listenMegaBrainStdio(createMegaBrainServer(), { input, output });

  const initialized = responseLine(output);
  input.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-host', version: '1.0.0' } },
  })}\n`);
  expect(await initialized).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'mega-brain-mcp' } } });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const listed = responseLine(output);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  const response = await listed;
  expect((response.result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)).toEqual(PUBLIC_TOOL_NAMES);

  input.end();
  await session.closed;
});

test('AC-041: gateway renova e libera sua lease mesmo quando a sessão falha @spec:AC-041', async () => {
  vi.useFakeTimers();
  const client = {
    acquire: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  let rejectSession!: (error: Error) => void;
  const session = new Promise<void>((_resolve, reject) => { rejectSession = reject; });
  const running = withProjectLease(client, 'lease-1', () => session, 10_000);

  await vi.advanceTimersByTimeAsync(20_000);
  expect(client.acquire).toHaveBeenCalledWith('lease-1');
  expect(client.heartbeat).toHaveBeenCalledTimes(2);
  rejectSession(new Error('host disconnected'));
  await expect(running).rejects.toThrow('host disconnected');
  expect(client.release).toHaveBeenCalledWith('lease-1');
});
