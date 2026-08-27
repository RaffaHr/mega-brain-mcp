export const PROVENANCE_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        checkout_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL UNIQUE,
        root TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_refs (
        memory_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES memory_refs(memory_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        symbol TEXT,
        blob_hash TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        UNIQUE(memory_id, path, symbol, blob_hash)
      );
      CREATE TABLE IF NOT EXISTS validations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES memory_refs(memory_id) ON DELETE CASCADE,
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL,
        validated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invalidations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES memory_refs(memory_id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        reason TEXT NOT NULL,
        commit_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supersessions (
        previous_memory_id TEXT PRIMARY KEY REFERENCES memory_refs(memory_id) ON DELETE CASCADE,
        replacement_memory_id TEXT NOT NULL REFERENCES memory_refs(memory_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hook_events (
        idempotency_key TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS backend_capabilities (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        backend TEXT NOT NULL,
        version TEXT NOT NULL,
        contract_hash TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY(project_id, backend)
      );
      CREATE INDEX IF NOT EXISTS evidence_memory_id_idx ON evidence(memory_id);
      CREATE INDEX IF NOT EXISTS memory_refs_project_state_idx ON memory_refs(project_id, state);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS evidence_with_null_symbol_idx
      ON evidence(memory_id, path, blob_hash)
      WHERE symbol IS NULL;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        statement,
        type,
        path,
        symbol,
        tokenize = 'porter unicode61'
      );
    `,
  },
] as const;
