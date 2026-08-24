export class LocalMetrics {
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();

  increment(name: string, amount = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + amount);
  }

  gauge(name: string, value: number): void {
    this.#gauges.set(name, value);
  }

  snapshot(): Readonly<{ counters: Record<string, number>; gauges: Record<string, number> }> {
    return {
      counters: Object.fromEntries(this.#counters),
      gauges: Object.fromEntries(this.#gauges),
    };
  }
}
