import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { assertAllowedCrgTool, assertExactCrgSurface, CRG_READ_ONLY_TOOLS, type CrgReadOnlyTool } from './allowlist.js';
import { crgToolResultSchema, crgToolsResponseSchema, type CrgToolResult } from './schemas.js';

export interface CrgSession {
  connect(): Promise<void>;
  listTools(): Promise<unknown>;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  serverVersion?(): { name?: string; version?: string } | undefined;
}

export interface CrgClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
  sessionFactory?: () => CrgSession;
}

function sdkSession(options: CrgClientOptions): CrgSession {
  const client = new Client({ name: 'mega-brain-mcp', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args ?? ['serve'],
    cwd: options.cwd,
    env: {
      ...getDefaultEnvironment(),
      ...(options.environment ?? {}),
      CRG_TOOLS: CRG_READ_ONLY_TOOLS.join(','),
    },
    stderr: 'pipe',
  });
  return {
    async connect() {
      await client.connect(transport);
    },
    async listTools() {
      return client.listTools();
    },
    async callTool(name, input) {
      return client.callTool({ name, arguments: input });
    },
    async close() {
      await client.close();
    },
    serverVersion() {
      return client.getServerVersion();
    },
  };
}

export class CodeReviewGraphClient {
  readonly #options: CrgClientOptions;
  readonly #timeoutMs: number;
  #session: CrgSession | null = null;
  #version: string | null = null;
  #tools: string[] = [];

  constructor(options: CrgClientOptions) {
    this.#options = options;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async #bounded<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Code Review Graph request timed out')), this.#timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async #close(session: CrgSession): Promise<void> {
    await Promise.race([
      session.close().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }

  async start(): Promise<void> {
    if (this.#session) return;
    const session = this.#options.sessionFactory?.() ?? sdkSession(this.#options);
    try {
      await this.#bounded(session.connect());
      const listed = crgToolsResponseSchema.parse(await this.#bounded(session.listTools()));
      this.#tools = listed.tools.map(({ name }) => name);
      assertExactCrgSurface(this.#tools);
      this.#version = session.serverVersion?.()?.version ?? null;
      this.#session = session;
    } catch (error) {
      await this.#close(session);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const session = this.#session;
    this.#session = null;
    this.#version = null;
    this.#tools = [];
    if (session) await this.#close(session);
  }

  async restart(): Promise<void> {
    await this.stop().catch(() => undefined);
    await this.start();
  }

  async call(tool: CrgReadOnlyTool, input: Record<string, unknown>, retry = true): Promise<CrgToolResult> {
    assertAllowedCrgTool(tool);
    await this.start();
    try {
      const result = crgToolResultSchema.parse(await this.#bounded(this.#session!.callTool(tool, input)));
      if (result.isError) throw new Error(`Code Review Graph tool failed: ${tool}`);
      return result;
    } catch (error) {
      if (!retry) throw error;
      await this.restart();
      return this.call(tool, input, false);
    }
  }

  serverVersion(): string | null {
    return this.#version;
  }

  tools(): readonly string[] {
    return [...this.#tools];
  }
}
