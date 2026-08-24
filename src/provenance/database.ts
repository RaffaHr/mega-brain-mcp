import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { PROVENANCE_MIGRATIONS } from './migrations.js';

export type ProvenanceDatabase = Database.Database;

export function openProvenanceDatabase(filePath: string): ProvenanceDatabase {
  if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const database = new Database(filePath);
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
