import pg from "pg";

let testPool: pg.Pool | null = null;

export async function getTestPool(): Promise<pg.Pool> {
  if (testPool) return testPool;

  const dbUrl =
    process.env.TEST_DB_URL ??
    "postgresql://test:test@localhost:5432/tiq_knowledge_test";

  testPool = new pg.Pool({
    connectionString: dbUrl,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });

  return testPool;
}

export async function cleanupTestDb(pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM _corrections");
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM patterns");
  await pool.query("DELETE FROM pitfalls");
  await pool.query("DELETE FROM preferences");
  await pool.query("DELETE FROM evolution");
}

export async function closeTestPool(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}
