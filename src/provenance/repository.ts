import type { ProvenanceDatabase } from './database.js';
import type { FreshnessState } from './freshness.js';

export interface EvidenceRecord {
  path: string;
  symbol?: string;
  blobHash: string;
  commitHash: string;
  startLine?: number;
  endLine?: number;
}

export class ProvenanceRepository {
  constructor(readonly database: ProvenanceDatabase) {}

  registerProject(project: { id: string; checkoutId: string; worktreeId: string; root: string }, now = new Date()): void {
    this.database.prepare(`
      INSERT INTO projects(id, checkout_id, worktree_id, root, created_at)
      VALUES(@id, @checkoutId, @worktreeId, @root, @createdAt)
      ON CONFLICT(id) DO UPDATE SET checkout_id=excluded.checkout_id, worktree_id=excluded.worktree_id, root=excluded.root
    `).run({ ...project, createdAt: now.toISOString() });
  }

  saveMemoryReference(input: {
    memoryId: string;
    projectId: string;
    state: FreshnessState;
    confidence: number;
    evidence: EvidenceRecord[];
  }, now = new Date()): void {
    this.database.transaction(() => {
      const timestamp = now.toISOString();
      this.database.prepare(`
        INSERT INTO memory_refs(memory_id, project_id, state, confidence, created_at, updated_at)
        VALUES(@memoryId, @projectId, @state, @confidence, @timestamp, @timestamp)
        ON CONFLICT(memory_id) DO UPDATE SET state=excluded.state, confidence=excluded.confidence, updated_at=excluded.updated_at
      `).run({ ...input, timestamp });
      const statement = this.database.prepare(`
        INSERT OR IGNORE INTO evidence(memory_id, path, symbol, blob_hash, commit_hash, start_line, end_line)
        VALUES(@memoryId, @path, @symbol, @blobHash, @commitHash, @startLine, @endLine)
      `);
      for (const evidence of input.evidence) statement.run({
        memoryId: input.memoryId,
        path: evidence.path,
        symbol: evidence.symbol ?? null,
        blobHash: evidence.blobHash,
        commitHash: evidence.commitHash,
        startLine: evidence.startLine ?? null,
        endLine: evidence.endLine ?? null,
      });
    })();
  }

  updateState(memoryId: string, state: FreshnessState, confidence: number, reason: string, now = new Date()): void {
    this.database.transaction(() => {
      this.database.prepare('UPDATE memory_refs SET state = ?, confidence = ?, updated_at = ? WHERE memory_id = ?')
        .run(state, confidence, now.toISOString(), memoryId);
      this.database.prepare('INSERT INTO invalidations(memory_id, state, reason, created_at) VALUES(?, ?, ?, ?)')
        .run(memoryId, state, reason, now.toISOString());
    })();
  }

  supersede(previousMemoryId: string, replacementMemoryId: string, now = new Date()): void {
    this.database.transaction(() => {
      this.database.prepare('UPDATE memory_refs SET state = ?, confidence = 0, updated_at = ? WHERE memory_id = ?')
        .run('DEPRECATED', now.toISOString(), previousMemoryId);
      this.database.prepare('INSERT OR REPLACE INTO supersessions(previous_memory_id, replacement_memory_id, created_at) VALUES(?, ?, ?)')
        .run(previousMemoryId, replacementMemoryId, now.toISOString());
    })();
  }

  memoryState(memoryId: string): { state: FreshnessState; confidence: number } | null {
    const row = this.database.prepare('SELECT state, confidence FROM memory_refs WHERE memory_id = ?').get(memoryId) as
      | { state: FreshnessState; confidence: number }
      | undefined;
    return row ?? null;
  }
}
