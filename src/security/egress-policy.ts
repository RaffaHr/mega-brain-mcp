export interface EgressPolicyOptions {
  allowEgress?: boolean;
  allowLlm?: boolean;
}

export class EgressDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressDeniedError';
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export class EgressPolicy {
  readonly #allowEgress: boolean;
  readonly #allowLlm: boolean;

  constructor(options: EgressPolicyOptions = {}) {
    this.#allowEgress = options.allowEgress ?? false;
    this.#allowLlm = options.allowLlm ?? false;
  }

  assertUrl(rawUrl: string): URL {
    const url = new URL(rawUrl);
    if (!isLoopback(url.hostname) && !this.#allowEgress) throw new EgressDeniedError(`External egress is disabled for ${url.origin}`);
    return url;
  }

  assertLlm(): void {
    if (!this.#allowLlm) throw new EgressDeniedError('LLM consumption is disabled');
    if (!this.#allowEgress) throw new EgressDeniedError('LLM consumption requires external egress');
  }

  snapshot(): Readonly<{ externalEgress: boolean; llm: boolean }> {
    return { externalEgress: this.#allowEgress, llm: this.#allowEgress && this.#allowLlm };
  }
}
