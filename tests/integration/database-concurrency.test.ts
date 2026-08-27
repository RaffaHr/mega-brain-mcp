import { afterEach, describe, expect, test } from 'vitest';

import { openProvenanceDatabase, type ProvenanceDatabase } from '../../src/provenance/database.js';

describe('database concurrency settings', () => {
  const databases: ProvenanceDatabase[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  test('AC-065: busy_timeout configurado para 5000ms nos backends SQLite @spec:AC-065', () => {
    // 1. Test default backend
    const db1 = openProvenanceDatabase(':memory:');
    databases.push(db1);
    const timeout1 = db1.pragma('busy_timeout', { simple: true });
    expect(Number(timeout1)).toBe(5000);

    // 2. Test node:sqlite backend explicitly
    const previous = process.env.MEGA_BRAIN_SQLITE_BACKEND;
    process.env.MEGA_BRAIN_SQLITE_BACKEND = 'node';
    try {
      const db2 = openProvenanceDatabase(':memory:');
      databases.push(db2);
      const timeout2 = db2.pragma('busy_timeout', { simple: true });
      expect(Number(timeout2)).toBe(5000);
    } finally {
      if (previous === undefined) delete process.env.MEGA_BRAIN_SQLITE_BACKEND;
      else process.env.MEGA_BRAIN_SQLITE_BACKEND = previous;
    }
  });
});
