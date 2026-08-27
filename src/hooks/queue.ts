import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { NormalizedHookEvent } from './events.js';

export interface HookQueueRecord {
  event: NormalizedHookEvent;
  status: 'pending' | 'processing' | 'processed' | 'dead';
  attempts: number;
  lastError?: string;
  updatedAt?: string;
}

export interface DurableHookQueueOptions {
  lockTimeoutMs?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export class DurableHookQueue {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #lockTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #maxAttempts: number;
  #serial: Promise<void> = Promise.resolve();

  constructor(path: string, options: DurableHookQueueOptions = {}) {
    this.#path = path;
    this.#lockPath = `${path}.lock`;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 25;
    this.#maxAttempts = options.maxAttempts ?? 5;
  }

  async #withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.#lockPath), { recursive: true });
    const deadline = Date.now() + this.#lockTimeoutMs;
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;

    while (!lockHandle) {
      try {
        const candidate = await open(this.#lockPath, 'wx', 0o600);
        try {
          await candidate.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
          lockHandle = candidate;
        } catch (error) {
          await candidate.close();
          await rm(this.#lockPath, { force: true });
          throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() > deadline) {
          // Break stale lock if expired
          try {
            const raw = JSON.parse(await readFile(this.#lockPath, 'utf8')) as { createdAt?: number };
            if (typeof raw.createdAt === 'number' && Date.now() - raw.createdAt > this.#lockTimeoutMs) {
              await rm(this.#lockPath, { force: true });
              continue;
            }
          } catch {
            await rm(this.#lockPath, { force: true });
            continue;
          }
          throw new Error(`Timeout acquiring hook queue lock on ${this.#lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, this.#pollIntervalMs));
      }
    }

    try {
      return await operation();
    } finally {
      await lockHandle.close();
      await rm(this.#lockPath, { force: true });
    }
  }

  async #readUnlocked(): Promise<HookQueueRecord[]> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8')) as HookQueueRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #writeUnlocked(records: HookQueueRecord[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async #mutate<T>(operation: (records: HookQueueRecord[]) => Promise<T> | T): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });

    this.#serial = this.#serial.then(async () => {
      try {
        const val = await this.#withFileLock(async () => {
          const records = await this.#readUnlocked();
          const value = await operation(records);
          await this.#writeUnlocked(records);
          return value;
        });
        resolveResult(val);
      } catch (error) {
        rejectResult(error);
      }
    });

    await this.#serial;
    return result;
  }

  async has(key: string): Promise<boolean> {
    const records = await this.#withFileLock(() => this.#readUnlocked());
    const record = records.find(({ event }) => event.key === key);
    if (!record) return false;
    // An event is only a true duplicate if it was successfully processed.
    // If it is pending or dead/failed, it is not considered an active duplicate.
    return record.status === 'processed';
  }

  async enqueue(event: NormalizedHookEvent, error: unknown): Promise<boolean> {
    return this.#mutate((records) => {
      const existing = records.find((record) => record.event.key === event.key);
      const errorMessage = error instanceof Error ? error.message : 'hook backend failed';
      const now = new Date().toISOString();

      if (existing) {
        if (existing.status === 'processed') return false;
        existing.attempts += 1;
        existing.lastError = errorMessage;
        existing.updatedAt = now;
        if (existing.attempts >= this.#maxAttempts) {
          existing.status = 'dead';
        } else {
          existing.status = 'pending';
        }
        return true;
      }

      records.push({
        event,
        status: 'pending',
        attempts: 1,
        lastError: errorMessage,
        updatedAt: now,
      });
      return true;
    });
  }

  async markProcessed(event: NormalizedHookEvent): Promise<boolean> {
    return this.#mutate((records) => {
      const now = new Date().toISOString();
      const existing = records.find((record) => record.event.key === event.key);
      if (existing) {
        existing.status = 'processed';
        existing.updatedAt = now;
        delete existing.lastError;
        return false;
      }
      records.push({ event, status: 'processed', attempts: 1, updatedAt: now });
      return true;
    });
  }

  async pending(): Promise<HookQueueRecord[]> {
    const records = await this.#withFileLock(() => this.#readUnlocked());
    return records.filter(({ status }) => status === 'pending');
  }
}
