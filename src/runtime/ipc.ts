import { chmod, rm } from 'node:fs/promises';
import net, { type Server, type Socket } from 'node:net';

import { z } from 'zod';

import { SUPERVISOR_PROTOCOL_VERSION, type SupervisorManifest } from './supervisor-manifest.js';

const requestSchema = z.object({
  protocolVersion: z.literal(SUPERVISOR_PROTOCOL_VERSION),
  worktreeId: z.string().regex(/^[a-f0-9]{24}$/u),
  type: z.enum(['status', 'acquire', 'heartbeat', 'release', 'drain']),
  leaseId: z.string().min(1).optional(),
}).strict();

export type SupervisorIpcRequest = z.infer<typeof requestSchema>;

const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    protocolVersion: z.literal(SUPERVISOR_PROTOCOL_VERSION),
    worktreeId: z.string(),
    pid: z.number().int().positive(),
    leases: z.array(z.string()),
    draining: z.boolean(),
  }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);

export type SupervisorIpcResponse = z.infer<typeof responseSchema>;

export interface SupervisorIpcServer {
  close(): Promise<void>;
}

export async function startSupervisorIpcServer(input: {
  address: string;
  handle(request: SupervisorIpcRequest): Promise<SupervisorIpcResponse> | SupervisorIpcResponse;
}): Promise<SupervisorIpcServer> {
  if (process.platform !== 'win32') await rm(input.address, { force: true });
  const sockets = new Set<Socket>();
  const server: Server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      void (async () => {
        try {
          const response = await input.handle(requestSchema.parse(JSON.parse(raw)));
          socket.end(`${JSON.stringify(responseSchema.parse(response))}\n`);
        } catch (error) {
          socket.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
        }
      })();
    });
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path: input.address, readableAll: false, writableAll: false }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') await chmod(input.address, 0o600);

  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (process.platform !== 'win32') await rm(input.address, { force: true });
    },
  };
}

export class SupervisorIpcClient {
  constructor(
    private readonly manifest: SupervisorManifest,
    private readonly timeoutMs = 2_000,
  ) {}

  private async request(type: SupervisorIpcRequest['type'], leaseId?: string): Promise<Extract<SupervisorIpcResponse, { ok: true }>> {
    const payload = {
      protocolVersion: SUPERVISOR_PROTOCOL_VERSION,
      worktreeId: this.manifest.worktreeId,
      type,
      ...(leaseId ? { leaseId } : {}),
    } satisfies SupervisorIpcRequest;

    const response = await new Promise<SupervisorIpcResponse>((resolve, reject) => {
      const socket = net.createConnection(this.manifest.ipcAddress);
      socket.setEncoding('utf8');
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('Supervisor IPC timeout')));
      let buffer = '';
      socket.once('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
      socket.on('data', (chunk: string) => { buffer += chunk; });
      socket.once('end', () => {
        try { resolve(responseSchema.parse(JSON.parse(buffer.trim()))); }
        catch (error) { reject(error); }
      });
      socket.once('error', reject);
    });
    if (!response.ok) throw new Error(response.error);
    if (response.protocolVersion !== this.manifest.protocolVersion
      || response.worktreeId !== this.manifest.worktreeId
      || response.pid !== this.manifest.pid) {
      throw new Error('Supervisor IPC identity mismatch');
    }
    return response;
  }

  async status(): Promise<{ leases: string[]; draining: boolean }> {
    const response = await this.request('status');
    return { leases: response.leases, draining: response.draining };
  }

  async drain(): Promise<{ leases: string[] }> {
    return { leases: (await this.request('drain')).leases };
  }
  async acquire(leaseId: string): Promise<void> { await this.request('acquire', leaseId); }
  async heartbeat(leaseId: string): Promise<void> { await this.request('heartbeat', leaseId); }
  async release(leaseId: string): Promise<void> { await this.request('release', leaseId); }
  async close(): Promise<void> {}
}
