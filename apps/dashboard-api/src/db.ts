import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Read-only pool for the analytics queries. The worker owns writes and schema;
 * the dashboard only reads, so this pool exists purely to serve metrics.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}
