import { afterEach, describe, expect, test } from 'vitest';

import { openProvenanceDatabase, type ProvenanceDatabase } from '../../src/provenance/database.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';

describe('provenance deduplication', () => {
  const databases: ProvenanceDatabase[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  test('AC-064: evidências sem símbolo são deduplicadas sem duplicatas infinitas @spec:AC-064', () => {
    const database = openProvenanceDatabase(':memory:');
    databases.push(database);

    const repository = new ProvenanceRepository(database);
    repository.registerProject({ id: 'proj-1', checkoutId: 'co-1', worktreeId: 'wt-1', root: '/repo' });

    // Save initial reference without symbol
    repository.saveMemoryReference({
      memoryId: 'mem-no-symbol',
      projectId: 'proj-1',
      state: 'FRESH',
      confidence: 1,
      evidence: [
        { path: 'src/main.ts', blobHash: 'blob-aaa', commitHash: 'commit-111' },
      ],
    });

    const rows1 = database.prepare('SELECT COUNT(*) as count FROM evidence WHERE memory_id = ?').get('mem-no-symbol') as { count: number };
    expect(rows1.count).toBe(1);

    // Save again with same path and blobHash (symbol is still undefined/null)
    repository.saveMemoryReference({
      memoryId: 'mem-no-symbol',
      projectId: 'proj-1',
      state: 'FRESH',
      confidence: 1,
      evidence: [
        { path: 'src/main.ts', blobHash: 'blob-aaa', commitHash: 'commit-111' },
      ],
    });

    const rows2 = database.prepare('SELECT COUNT(*) as count FROM evidence WHERE memory_id = ?').get('mem-no-symbol') as { count: number };
    expect(rows2.count).toBe(1);

    // Save a different blob or path -> adds a second record
    repository.saveMemoryReference({
      memoryId: 'mem-no-symbol',
      projectId: 'proj-1',
      state: 'FRESH',
      confidence: 1,
      evidence: [
        { path: 'src/other.ts', blobHash: 'blob-bbb', commitHash: 'commit-111' },
      ],
    });

    const rows3 = database.prepare('SELECT COUNT(*) as count FROM evidence WHERE memory_id = ?').get('mem-no-symbol') as { count: number };
    expect(rows3.count).toBe(2);
  });
});
