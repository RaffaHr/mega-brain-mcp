export interface LeaseRegistryOptions {
  now?: () => number;
  heartbeatIntervalMs?: number;
  leaseTtlMs?: number;
  shutdownGraceMs?: number;
}

interface Lease {
  id: string;
  renewedAt: number;
}

export class LeaseRegistry {
  readonly heartbeatIntervalMs: number;
  readonly leaseTtlMs: number;
  readonly shutdownGraceMs: number;
  private readonly now: () => number;
  private readonly leases = new Map<string, Lease>();
  private emptySince: number | null = null;

  constructor(options: LeaseRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
    if (this.heartbeatIntervalMs <= 0 || this.leaseTtlMs <= this.heartbeatIntervalMs || this.shutdownGraceMs < 0) {
      throw new Error('Invalid lease timing configuration');
    }
  }

  acquire(id: string): void {
    if (!id.trim()) throw new Error('Lease id must not be empty');
    this.leases.set(id, { id, renewedAt: this.now() });
    this.emptySince = null;
  }

  heartbeat(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) throw new Error(`Unknown lease ${id}`);
    lease.renewedAt = this.now();
  }

  release(id: string): boolean {
    const removed = this.leases.delete(id);
    if (removed && this.leases.size === 0) this.emptySince = this.now();
    return removed;
  }

  pruneExpired(): string[] {
    const now = this.now();
    const expired = [...this.leases.values()]
      .filter((lease) => now - lease.renewedAt > this.leaseTtlMs)
      .map((lease) => lease.id)
      .sort();
    for (const id of expired) this.leases.delete(id);
    if (expired.length > 0 && this.leases.size === 0 && this.emptySince === null) this.emptySince = now;
    return expired;
  }

  activeIds(): string[] {
    this.pruneExpired();
    return [...this.leases.keys()].sort();
  }

  shouldShutdown(): boolean {
    this.pruneExpired();
    return this.leases.size === 0
      && this.emptySince !== null
      && this.now() - this.emptySince >= this.shutdownGraceMs;
  }
}
