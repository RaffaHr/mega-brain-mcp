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
    statement?: string;
    type?: string;
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

      if (input.statement) {
        try {
          const paths = input.evidence.map((e) => e.path).join(' ');
          const symbols = input.evidence.map((e) => e.symbol).filter(Boolean).join(' ');
          this.database.prepare(`
            INSERT OR REPLACE INTO memory_fts(memory_id, statement, type, path, symbol)
            VALUES(?, ?, ?, ?, ?)
          `).run(input.memoryId, input.statement, input.type ?? 'fact', paths, symbols);
        } catch {
          // FTS5 optional fallback if virtual table is not present
        }
      }
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

  evidenceForMemory(memoryId: string): EvidenceRecord[] {
    return this.database.prepare(`
      SELECT path, symbol, blob_hash AS blobHash, commit_hash AS commitHash,
             start_line AS startLine, end_line AS endLine
      FROM evidence WHERE memory_id = ? ORDER BY path, symbol
    `).all(memoryId).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        path: String(value.path),
        blobHash: String(value.blobHash),
        commitHash: String(value.commitHash),
        ...(typeof value.symbol === 'string' ? { symbol: value.symbol } : {}),
        ...(typeof value.startLine === 'number' ? { startLine: value.startLine } : {}),
        ...(typeof value.endLine === 'number' ? { endLine: value.endLine } : {}),
      };
    });
  }

  memoryIdsForPaths(paths: string[]): string[] {
    if (paths.length === 0) return [];
    const placeholders = paths.map(() => '?').join(',');
    return (this.database.prepare(`SELECT DISTINCT memory_id AS memoryId FROM evidence WHERE path IN (${placeholders}) ORDER BY memory_id`).all(...paths) as Array<{ memoryId: string }>).map(({ memoryId }) => memoryId);
  }

  findMemoriesByState(state: FreshnessState): Array<{ memoryId: string }> {
    return this.database.prepare(`
      SELECT memory_id AS memoryId
      FROM memory_refs
      WHERE state = ?
    `).all(state) as Array<{ memoryId: string }>;
  }

  findCandidateMemories(filter?: { commitHash?: string; paths?: string[] }): Array<{ memoryId: string }> {
    if (filter?.commitHash) {
      return this.database.prepare(`
        SELECT DISTINCT m.memory_id AS memoryId
        FROM memory_refs m
        JOIN evidence e ON m.memory_id = e.memory_id
        WHERE m.state = 'CANDIDATE' AND e.commit_hash = ?
      `).all(filter.commitHash) as Array<{ memoryId: string }>;
    }
    return this.database.prepare(`
      SELECT DISTINCT memory_id AS memoryId
      FROM memory_refs
      WHERE state = 'CANDIDATE'
    `).all() as Array<{ memoryId: string }>;
  }

  memoryCountsByState(): Record<string, number> {
    const rows = this.database.prepare(`
      SELECT state, count(*) as count
      FROM memory_refs
      GROUP BY state
    `).all() as Array<{ state: string; count: number }>;

    const counts: Record<string, number> = {
      ACTIVE: 0,
      POSSIBLY_STALE: 0,
      STALE: 0,
      SUPERSEDED: 0,
      CANDIDATE: 0,
      DEPRECATED: 0,
      UNKNOWN: 0,
      FRESH: 0,
    };
    for (const row of rows) {
      counts[row.state] = Number(row.count);
    }
    return counts;
  }

  findConsolidationCandidates(projectId: string, minGroupSize = 2): Array<{
    path: string;
    type: string;
    memoryIds: string[];
    statements: string[];
    blobHash?: string;
    commitHash?: string;
  }> {
    const rows = this.database.prepare(`
      SELECT e.path, COALESCE(f.type, 'fact') AS type, m.memory_id AS memoryId,
             COALESCE(f.statement, '') AS statement, e.blob_hash AS blobHash, e.commit_hash AS commitHash
      FROM memory_refs m
      JOIN evidence e ON m.memory_id = e.memory_id
      LEFT JOIN memory_fts f ON m.memory_id = f.memory_id
      WHERE m.project_id = ? AND m.state IN ('ACTIVE', 'FRESH', 'CANDIDATE')
      ORDER BY e.path, type
    `).all(projectId) as Array<{
      path: string;
      type: string;
      memoryId: string;
      statement: string;
      blobHash: string;
      commitHash: string;
    }>;

    const groupMap = new Map<string, {
      path: string;
      type: string;
      memoryIds: string[];
      statements: string[];
      blobHash?: string;
      commitHash?: string;
    }>();

    for (const row of rows) {
      const key = `${row.path}:::${row.type}`;
      const existing = groupMap.get(key);
      if (!existing) {
        groupMap.set(key, {
          path: row.path,
          type: row.type,
          memoryIds: [row.memoryId],
          statements: row.statement ? [row.statement] : [],
          blobHash: row.blobHash,
          commitHash: row.commitHash,
        });
      } else {
        if (!existing.memoryIds.includes(row.memoryId)) {
          existing.memoryIds.push(row.memoryId);
          if (row.statement) existing.statements.push(row.statement);
        }
      }
    }

    return Array.from(groupMap.values()).filter((g) => g.memoryIds.length >= minGroupSize);
  }

  searchLexical(query: string, limit = 10): Array<{ memoryId: string; statement: string; type: string; score: number }> {
    const sanitized = query.replace(/[^\w\s]/g, ' ').trim();
    if (!sanitized) return [];
    try {
      const terms = sanitized.split(/\s+/).filter((t) => t.length > 1).map((t) => `"${t}"*`).join(' OR ');
      if (!terms) return [];
      const rows = this.database.prepare(`
        SELECT f.memory_id AS memoryId, f.statement, f.type, bm25(memory_fts) AS bm25Rank
        FROM memory_fts f
        WHERE memory_fts MATCH ?
        ORDER BY bm25Rank ASC
        LIMIT ?
      `).all(terms, limit) as Array<{ memoryId: string; statement: string; type: string; bm25Rank: number }>;
      return rows.map((row) => ({
        memoryId: row.memoryId,
        statement: row.statement,
        type: row.type,
        score: Math.max(0.1, 1 / (1 + Math.abs(row.bm25Rank))),
      }));
    } catch {
      return [];
    }
  }
}
