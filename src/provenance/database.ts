import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { PROVENANCE_MIGRATIONS } from './migrations.js';

const require = createRequire(import.meta.url);

export interface ProvenanceStatement {
  run(...parameters: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface ProvenanceDatabase {
  prepare(sql: string): ProvenanceStatement;
  exec(sql: string): unknown;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<T>(work: () => T): () => T;
  close(): void;
}

interface NodeSqliteStatement {
  run(...parameters: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  setAllowBareNamedParameters?(enabled: boolean): void;
  setAllowUnknownNamedParameters?(enabled: boolean): void;
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type NodeSqliteModule = {
  DatabaseSync: new (filePath: string) => NodeSqliteDatabase;
};

function openBetterSqlite(filePath: string): ProvenanceDatabase | null {
  if (process.env.MEGA_BRAIN_SQLITE_BACKEND === 'node') return null;
  try {
    const module = require('better-sqlite3') as { default?: new (filePath: string) => ProvenanceDatabase } | (new (filePath: string) => ProvenanceDatabase);
    const Database = typeof module === 'function' ? module : module.default;
    return Database ? new Database(filePath) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Could not locate the bindings file|Cannot find module|ERR_DLOPEN_FAILED/u.test(message)) return null;
    throw error;
  }
}

class NodeSqliteProvenanceDatabase implements ProvenanceDatabase {
  constructor(private readonly database: NodeSqliteDatabase) {}

  prepare(sql: string): ProvenanceStatement {
    const statement = this.database.prepare(sql);
    statement.setAllowBareNamedParameters?.(true);
    statement.setAllowUnknownNamedParameters?.(true);
    return statement;
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    if (/=/u.test(sql)) {
      this.database.exec(`PRAGMA ${sql}`);
      return undefined;
    }
    const rows = this.database.prepare(`PRAGMA ${sql}`).all();
    if (options?.simple) {
      const first = rows[0] as Record<string, unknown> | undefined;
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  transaction<T>(work: () => T): () => T {
    return () => {
      this.database.exec('BEGIN');
      try {
        const result = work();
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    this.database.close();
  }
}

function openNodeSqlite(filePath: string): ProvenanceDatabase | null {
  try {
    const { DatabaseSync } = require('node:sqlite') as NodeSqliteModule;
    return new NodeSqliteProvenanceDatabase(new DatabaseSync(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_UNKNOWN_BUILTIN_MODULE') return null;
    throw error;
  }
}

export function openProvenanceDatabase(filePath: string): ProvenanceDatabase {
  if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const database = openBetterSqlite(filePath) ?? openNodeSqlite(filePath);
  if (!database) throw new Error('No compatible SQLite backend is available. Install better-sqlite3 with native bindings or use Node.js with node:sqlite.');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  const currentVersion = database.pragma('user_version', { simple: true }) as number;
  for (const migration of PROVENANCE_MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
  return database;
}
