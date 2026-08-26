import type { z } from 'zod';

import {
  agentMemoryHealthSchema,
  expandedSmartSearchResponseSchema,
  genericAgentMemoryResponseSchema,
  memoriesResponseSchema,
  memoryByIdResponseSchema,
  rememberResponseSchema,
  sessionsResponseSchema,
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

  async #request<T>(method: 'GET' | 'POST' | 'DELETE', endpoint: string, schema: z.ZodType<T>, body?: unknown, query?: Record<string, string>): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.#authToken) headers.set('Authorization', `Bearer ${this.#authToken}`);
    let response: Response;
    try {
      const url = new URL(endpoint.replace(/^\//, ''), this.#baseUrl);
      for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
      response = await this.#fetch(url, {
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

  async smartSearch(input: { query: string; limit?: number; project?: string; requireHydratedResults?: boolean }) {
    const { requireHydratedResults, ...searchInput } = input;
    const compact = await this.#request('POST', '/agentmemory/smart-search', smartSearchResponseSchema, searchInput);
    const expandIds = compact.results.flatMap(({ id, obsId, content }) => {
      const candidateId = obsId ?? id;
      return candidateId && (requireHydratedResults || !content) ? [candidateId] : [];
    });
    if (expandIds.length === 0) return compact;
    const expanded = await this.#request('POST', '/agentmemory/smart-search', expandedSmartSearchResponseSchema, { expandIds });
    const expandedById = new Map(expanded.results.flatMap((record) => record.id ? [[record.id, record] as const] : []));
    const missingIds = expandIds.filter((id) => !expandedById.has(id));
    const memoryResults = await Promise.allSettled(missingIds.map((id) => this.#request(
      'GET', `/agentmemory/memories/${encodeURIComponent(id)}`, memoryByIdResponseSchema,
      undefined,
      searchInput.project ? { project: searchInput.project } : undefined,
    )));
    const memoriesById = new Map(memoryResults.flatMap((result) => result.status === 'fulfilled' && result.value.id
      ? [[result.value.id, result.value] as const]
      : []));
    const scores = new Map(compact.results.flatMap(({ id, obsId, score }) => {
      const key = id ?? obsId;
      return key && score !== undefined ? [[key, score] as const] : [];
    }));
    return {
      results: compact.results.flatMap((record) => {
        const id = record.id ?? record.obsId;
        const hydrated = id ? expandedById.get(id) ?? memoriesById.get(id) : undefined;
        if (requireHydratedResults && !hydrated) return [];
        if (requireHydratedResults && searchInput.project && hydrated?.project && hydrated.project !== searchInput.project) return [];
        const normalized = hydrated ?? { ...record, id, content: record.content ?? record.title };
        return [{ ...normalized, ...(id && scores.has(id) ? { score: scores.get(id) } : {}) }];
      }),
    };
  }

  remember(input: { content: string; concepts?: string[]; metadata?: Record<string, unknown>; project?: string }) {
    return this.#request('POST', '/agentmemory/remember', rememberResponseSchema, input);
  }

  async memories(input: { project?: string } = {}) {
    const response = await this.#request('GET', '/agentmemory/memories', memoriesResponseSchema);
    return {
      ...response,
      memories: input.project
        ? response.memories.filter(({ project }) => project === input.project)
        : response.memories,
    };
  }

  verify(input: { ids?: string[]; query?: string; project?: string }) {
    return this.#request('POST', '/agentmemory/verify', genericAgentMemoryResponseSchema, input);
  }

  timeline(input: { anchor: string; before?: number; after?: number; project?: string }) {
    return this.#request('POST', '/agentmemory/timeline', genericAgentMemoryResponseSchema, input);
  }

  async sessions(input: { project?: string } = {}) {
    const response = await this.#request('GET', '/agentmemory/sessions', sessionsResponseSchema);
    return {
      ...response,
      sessions: input.project
        ? response.sessions.filter(({ project }) => project === input.project)
        : response.sessions,
    };
  }

  governanceDelete(input: { memoryIds: string[]; project: string; reason: string }) {
    return this.#request('DELETE', '/agentmemory/governance/memories', genericAgentMemoryResponseSchema, input);
  }
}
