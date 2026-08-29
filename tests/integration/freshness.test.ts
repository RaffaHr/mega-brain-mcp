import { afterEach, expect, test } from 'vitest';

import { openProvenanceDatabase, type ProvenanceDatabase } from '../../src/provenance/database.js';
import { stateAfterValidation } from '../../src/provenance/conflicts.js';
import { assessFreshness } from '../../src/provenance/freshness.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';

const databases: ProvenanceDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

test('AC-010: mudança não relacionada preserva memória válida @spec:AC-010', () => {
  expect(assessFreshness({ evidence: [
    { path: 'src/auth.ts', storedHash: 'same', currentHash: 'same' },
  ] })).toEqual({ state: 'FRESH', confidence: 1, reasons: ['all_evidence_hashes_match'] });
});

test('AC-011: mudança direta indireta ou não commitada invalida confiança @spec:AC-011', () => {
  expect(assessFreshness({ evidence: [
    { path: 'src/auth.ts', storedHash: 'old', currentHash: 'new' },
  ] })).toMatchObject({ state: 'POSSIBLY_STALE', reasons: ['evidence_changed'] });
  expect(assessFreshness({ evidence: [
    { path: 'src/auth.ts', storedHash: 'same', currentHash: 'same', inBlastRadius: true, workingTreeChanged: true },
  ] })).toMatchObject({ state: 'POSSIBLY_STALE', reasons: ['related_symbol_changed', 'relevant_worktree_change'] });
});

test('AC-012: remoção contradição e substituição têm estados distintos @spec:AC-012', () => {
  expect(assessFreshness({ evidence: [{ path: 'gone.ts', storedHash: 'old', currentHash: null }] }).state).toBe('STALE');
  expect(assessFreshness({ evidence: [], conflict: true }).state).toBe('CONFLICT');
  expect(assessFreshness({ evidence: [], supersededBy: 'memory-2' }).state).toBe('DEPRECATED');
  expect(stateAfterValidation('refuted', true)).toBe('CONFLICT');
});

test('P-003: freshness exige evidência atual @principle:P-003', () => {
  expect(assessFreshness({ evidence: [] }).state).toBe('UNKNOWN');
  expect(assessFreshness({ evidence: [{ path: 'a.ts', storedHash: 'x', currentHash: 'y' }] }).state).not.toBe('FRESH');
});

test('metadata stores references and hashes without storing memory content', () => {
  const database = openProvenanceDatabase(':memory:');
  databases.push(database);
  const repository = new ProvenanceRepository(database);
  repository.registerProject({ id: 'repo', checkoutId: 'checkout', worktreeId: 'worktree', root: '/repo' });
  repository.saveMemoryReference({
    memoryId: 'memory-1',
    projectId: 'repo',
    state: 'FRESH',
    confidence: 1,
    evidence: [{ path: 'src/auth.ts', symbol: 'login', blobHash: 'blob', commitHash: 'commit' }],
  });
  expect(repository.memoryState('memory-1')).toEqual({ state: 'FRESH', confidence: 1 });
  expect(database.prepare("SELECT name FROM pragma_table_info('memory_refs') WHERE name = 'content'").get()).toBeUndefined();
});

test('memory state counts keep every persisted state and always report the known ones', () => {
  const database = openProvenanceDatabase(':memory:');
  databases.push(database);
  const repository = new ProvenanceRepository(database);
  repository.registerProject({ id: 'repo', checkoutId: 'checkout', worktreeId: 'worktree', root: '/repo' });

  expect(Object.keys(repository.memoryCountsByState()).sort()).toEqual([
    'ACTIVE', 'CANDIDATE', 'CONFLICT', 'DEPRECATED', 'FRESH', 'POSSIBLY_STALE', 'STALE', 'SUPERSEDED', 'UNKNOWN',
  ]);

  for (const memoryId of ['memory-conflict', 'memory-unknown-state']) {
    repository.saveMemoryReference({
      memoryId,
      projectId: 'repo',
      state: 'FRESH',
      confidence: 1,
      evidence: [{ path: 'src/auth.ts', blobHash: 'blob', commitHash: 'commit' }],
    });
  }
  repository.updateState('memory-conflict', 'CONFLICT', 0.2, 'current_evidence_conflicts');
  database.prepare("UPDATE memory_refs SET state = 'WEIRD' WHERE memory_id = ?").run('memory-unknown-state');

  const counts = repository.memoryCountsByState();

  expect(counts.CONFLICT).toBe(1);
  expect(counts.WEIRD).toBe(1);
  expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(2);
  expect(repository.memoryCountsByState().SUPERSEDED).toBe(0);
});

test('provenance funciona com node:sqlite quando better-sqlite3 nativo nao esta disponivel', () => {
  const previous = process.env.MEGA_BRAIN_SQLITE_BACKEND;
  process.env.MEGA_BRAIN_SQLITE_BACKEND = 'node';
  try {
    const database = openProvenanceDatabase(':memory:');
    databases.push(database);
    const repository = new ProvenanceRepository(database);
    repository.registerProject({ id: 'repo-node', checkoutId: 'checkout', worktreeId: 'worktree-node', root: '/repo' });
    repository.saveMemoryReference({
      memoryId: 'memory-node',
      projectId: 'repo-node',
      state: 'FRESH',
      confidence: 0.9,
      evidence: [{ path: 'src/index.ts', blobHash: 'blob', commitHash: 'commit' }],
    });

    expect(repository.memoryState('memory-node')).toEqual({ state: 'FRESH', confidence: 0.9 });
    expect(repository.memoryIdsForPaths(['src/index.ts'])).toEqual(['memory-node']);
  } finally {
    if (previous === undefined) delete process.env.MEGA_BRAIN_SQLITE_BACKEND;
    else process.env.MEGA_BRAIN_SQLITE_BACKEND = previous;
  }
});
