import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  console.error('Unexpected idle database client error', err);
});

/** Runs fn inside a single transaction, committing on success and rolling back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const REQUIRED_TABLES = ['users', 'products', 'cart_items', 'orders', 'order_items', 'discount_codes'];

/**
 * Applies db/schema.sql when any of the application tables is missing. The file is idempotent
 * (IF NOT EXISTS throughout), so an existing database picks up newly added tables and columns.
 */
export async function ensureSchema(): Promise<void> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [REQUIRED_TABLES],
  );
  if (rows.length === REQUIRED_TABLES.length) return;

  const schemaPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await withTransaction(async (client) => {
    await client.query(sql);
  });
  console.log('Database schema applied');
}
