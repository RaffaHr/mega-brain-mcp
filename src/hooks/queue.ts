import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { NormalizedHookEvent } from './events.js';

export interface HookQueueRecord {
  event: NormalizedHookEvent;
  status: 'pending' | 'processed';
  attempts: number;
  lastError?: string;
}

export class DurableHookQueue {
  readonly #path: string;
  #serial: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async #read(): Promise<HookQueueRecord[]> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8')) as HookQueueRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #write(records: HookQueueRecord[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async #mutate<T>(operation: (records: HookQueueRecord[]) => Promise<T> | T): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.#serial = this.#serial.then(async () => {
      try {
        const records = await this.#read();
        const value = await operation(records);
        await this.#write(records);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    await this.#serial;
    return result;
  }

  async has(key: string): Promise<boolean> {
    return (await this.#read()).some(({ event }) => event.key === key);
  }

  async enqueue(event: NormalizedHookEvent, error: unknown): Promise<boolean> {
    return this.#mutate((records) => {
      if (records.some((record) => record.event.key === event.key)) return false;
      records.push({ event, status: 'pending', attempts: 1, lastError: error instanceof Error ? error.message : 'hook backend failed' });
      return true;
    });
  }

  async markProcessed(event: NormalizedHookEvent): Promise<boolean> {
    return this.#mutate((records) => {
      const existing = records.find((record) => record.event.key === event.key);
      if (existing) {
        existing.status = 'processed';
        delete existing.lastError;
        return false;
      }
      records.push({ event, status: 'processed', attempts: 1 });
      return true;
    });
  }

  async pending(): Promise<HookQueueRecord[]> {
    return (await this.#read()).filter(({ status }) => status === 'pending');
  }
}
