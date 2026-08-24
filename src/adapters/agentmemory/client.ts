import type { z } from 'zod';

import {
  agentMemoryHealthSchema,
  genericAgentMemoryResponseSchema,
  rememberResponseSchema,
  smartSearchResponseSchema,
} from './schemas.js';

export interface AgentMemoryClientOptions {
  baseUrl: string;
  authToken?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class AgentMemoryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AgentMemoryError';
  }
}

export class AgentMemoryClient {
  readonly #baseUrl: URL;
  readonly #authToken: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: AgentMemoryClientOptions) {
    this.#baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.#authToken = options.authToken;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #request<T>(method: 'GET' | 'POST', endpoint: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.#authToken) headers.set('Authorization', `Bearer ${this.#authToken}`);
    let response: Response;
    try {
      response = await this.#fetch(new URL(endpoint.replace(/^\//, ''), this.#baseUrl), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new AgentMemoryError(`AgentMemory request failed: ${error instanceof Error ? error.name : 'network error'}`, null, true);
    }
    if (!response.ok) {
      throw new AgentMemoryError(`AgentMemory returned HTTP ${response.status}`, response.status, response.status >= 500 || response.status === 429);
    }
    const payload: unknown = await response.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AgentMemoryError('AgentMemory returned an incompatible response schema', response.status, false);
    return parsed.data;
  }

  livez(): Promise<Record<string, unknown>> {
    return this.#request('GET', '/agentmemory/livez', genericAgentMemoryResponseSchema);
  }

  health() {
    return this.#request('GET', '/agentmemory/health', agentMemoryHealthSchema);
  }

  smartSearch(input: { query: string; limit?: number; project?: string }) {
    return this.#request('POST', '/agentmemory/smart-search', smartSearchResponseSchema, input);
  }

  remember(input: { content: string; concepts?: string[]; metadata?: Record<string, unknown> }) {
    return this.#request('POST', '/agentmemory/remember', rememberResponseSchema, input);
  }

  verify(input: { ids?: string[]; query?: string }) {
    return this.#request('POST', '/agentmemory/verify', genericAgentMemoryResponseSchema, input);
  }

  timeline(input: { query?: string; limit?: number; start?: string; end?: string }) {
    return this.#request('POST', '/agentmemory/timeline', genericAgentMemoryResponseSchema, input);
  }

  sessions() {
    return this.#request('GET', '/agentmemory/sessions', genericAgentMemoryResponseSchema);
  }
}
