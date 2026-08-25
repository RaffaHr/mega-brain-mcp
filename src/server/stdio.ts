import type { Readable, Writable } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { createMegaBrainServer } from './index.js';

export interface MegaBrainStdioSession {
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function listenMegaBrainStdio(
  server: ReturnType<typeof createMegaBrainServer>,
  streams: { input?: Readable; output?: Writable } = {},
): Promise<MegaBrainStdioSession> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const transport = new StdioServerTransport(input, output);
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      input.off('end', onInputClosed);
      input.off('close', onInputClosed);
      await transport.close().catch(() => undefined);
      await server.nativeServer.close().catch(() => undefined);
      resolveClosed();
    })();
    return closing;
  };
  const onInputClosed = () => { void close(); };

  await server.nativeServer.connect(transport);
  input.once('end', onInputClosed);
  input.once('close', onInputClosed);
  return { closed, close };
}
