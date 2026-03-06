import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function loadMigrations(): Migration[] {
  const migrationsDir = join(__dirname, "migrations");
  const migrations: Migration[] = [];

  try {
    const files = ["001_initial_schema.sql", "002_add_vector_indexes.sql"];
    for (const file of files) {
      const version = parseInt(file.split("_")[0], 10);
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      migrations.push({ version, sql });
    }
  } catch (err) {
    console.error("[db] Failed to load migration files:", err);
  }

  return migrations.sort((a, b) => a.version - b.version);
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
