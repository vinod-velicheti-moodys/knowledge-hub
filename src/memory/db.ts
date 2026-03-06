import pg from "pg";
import { config } from "../config.js";

let pool: pg.Pool | null = null;
let dbAvailable = false;

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Database not initialized. Call initDb() first.");
  return pool;
}

export function isDbAvailable(): boolean {
  return dbAvailable;
}

export async function ensureDb(): Promise<boolean> {
  if (dbAvailable) return true;
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    dbAvailable = true;
    return true;
  } catch {
    return false;
  }
}

interface Migration {
  version: number;
  sql: string;
}

const MIGRATION_001 = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  summary TEXT NOT NULL,
  details TEXT,
  ticket_id TEXT,
  pr_number TEXT,
  files JSONB DEFAULT '[]',
  components JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  embedding vector(384),
  author TEXT,
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  archived BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_events_components ON events USING gin(components);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  ticket_id TEXT,
  current_phase TEXT NOT NULL DEFAULT 'planning',
  active_files JSONB DEFAULT '[]',
  modified_files JSONB DEFAULT '[]',
  decisions JSONB DEFAULT '[]',
  attempts JSONB DEFAULT '[]',
  findings JSONB DEFAULT '[]',
  reusability_matrix JSONB DEFAULT '[]',
  developer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer);
CREATE INDEX IF NOT EXISTS idx_sessions_files ON sessions USING gin(active_files);

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL DEFAULT 0.3,
  occurrences INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  sources JSONB DEFAULT '[]',
  last_author TEXT,
  embedding vector(384),
  archived BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS pitfalls (
  id TEXT PRIMARY KEY,
  mistake TEXT NOT NULL,
  fix TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_occurred TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  tags JSONB DEFAULT '[]',
  last_author TEXT,
  embedding vector(384),
  archived BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  preference TEXT NOT NULL,
  observed_from JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS evolution (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  history TEXT NOT NULL,
  current_state TEXT NOT NULL,
  planned_changes TEXT
);

CREATE TABLE IF NOT EXISTS _corrections (
  id TEXT PRIMARY KEY,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const MIGRATION_002 = `
CREATE INDEX IF NOT EXISTS idx_events_embedding ON events
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_patterns_embedding ON patterns
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_pitfalls_embedding ON pitfalls
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
`;

function loadMigrations(): Migration[] {
  return [
    { version: 1, sql: MIGRATION_001 },
    { version: 2, sql: MIGRATION_002 },
  ];
}

const MIGRATION_LOCK_ID = 738291;

async function migrate(p: pg.Pool): Promise<void> {
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows } = await client.query(
      "SELECT COALESCE(MAX(version), 0) AS v FROM _migrations"
    );
    const currentVersion = rows[0].v;

    const migrations = loadMigrations();

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO _migrations (version) VALUES ($1)",
            [migration.version]
          );
          await client.query("COMMIT");
          console.error(`[db] Applied migration ${migration.version}`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    }

    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  } finally {
    client.release();
  }
}

async function checkModelVersion(p: pg.Pool, modelId: string): Promise<void> {
  const { rows } = await p.query(
    "SELECT value FROM _meta WHERE key = 'embedding_model'"
  );
  if (rows.length === 0) {
    await p.query(
      "INSERT INTO _meta (key, value) VALUES ('embedding_model', $1)",
      [modelId]
    );
  } else if (rows[0].value !== modelId) {
    throw new Error(
      `Embedding model mismatch: DB was seeded with "${rows[0].value}" but this instance uses "${modelId}". ` +
        `All team members must use the same model. Re-embed all data or update MCP_EMBEDDING_MODEL.`
    );
  }
}

export async function initDb(): Promise<void> {
  pool = new pg.Pool({
    connectionString: config.dbUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    console.error("[db] Pool error, entering degraded mode:", err.message);
    dbAvailable = false;
  });

  try {
    await pool.query("SELECT 1");
    dbAvailable = true;
    console.error("[db] Connected to PostgreSQL");

    await migrate(pool);
    await checkModelVersion(pool, config.embeddingModel);

    console.error("[db] Migrations complete, model version verified");
  } catch (err) {
    console.error("[db] Failed to connect or migrate:", err);
    dbAvailable = false;
    console.error(
      "[db] Running in degraded mode -- semantic tools work, memory tools will retry"
    );
  }
}

export async function shutdown(): Promise<void> {
  if (pool) {
    console.error("[db] Shutting down, draining pool...");
    await pool.end();
    pool = null;
    dbAvailable = false;
  }
}
