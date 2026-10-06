import { PoolClient } from 'pg';
import { pool } from '../db';
import { badRequest, conflict, notFound } from '../errors';

export const CODE_PATTERN = /^[A-Za-z0-9]{1,20}$/;
export const MAX_PERCENTAGE = 50;

export type DiscountType = 'percentage' | 'fixed';

export interface DiscountCode {
  id: number;
  code: string;
  type: DiscountType;
  value: number;
  minSubtotalCents: number;
  expiresAt: string | null;
  active: boolean;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
}

interface DiscountCodeRow {
  id: number;
  code: string;
  type: DiscountType;
  value: number;
  min_subtotal_cents: number;
  expires_at: Date | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, code, type, value, min_subtotal_cents, expires_at, active, created_at, updated_at';

// Orders that currently hold a code; cancelled orders have released theirs.
const TIMES_USED_SQL = `(SELECT count(*) FROM orders o
   WHERE o.discount_code_id = d.id AND o.status <> 'cancelled')::int AS times_used`;

function toDiscountCode(row: DiscountCodeRow & { times_used?: number }): DiscountCode {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minSubtotalCents: row.min_subtotal_cents,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    active: row.active,
    timesUsed: row.times_used ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface DiscountCodeInput {
  code: string;
  type: DiscountType;
  value: number;
  minSubtotalCents: number;
  expiresAt: Date | null;
}

export async function create(input: DiscountCodeInput): Promise<DiscountCode> {
  try {
    const { rows } = await pool.query<DiscountCodeRow>(
      `INSERT INTO discount_codes (code, type, value, min_subtotal_cents, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [input.code, input.type, input.value, input.minSubtotalCents, input.expiresAt],
    );
    return toDiscountCode(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('a discount code with that name already exists');
    throw err;
  }
}

export async function list(): Promise<DiscountCode[]> {
  const { rows } = await pool.query<DiscountCodeRow & { times_used: number }>(
    `SELECT ${COLUMNS}, ${TIMES_USED_SQL} FROM discount_codes d ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(toDiscountCode);
}

export async function deactivate(id: number): Promise<DiscountCode> {
  const { rows } = await pool.query<DiscountCodeRow & { times_used: number }>(
    `UPDATE discount_codes d SET active = FALSE, updated_at = now() WHERE id = $1
     RETURNING ${COLUMNS}, ${TIMES_USED_SQL}`,
    [id],
  );
  if (rows.length === 0) throw notFound('discount code not found');
  return toDiscountCode(rows[0]);
}

export function discountFor(code: { type: DiscountType; value: number }, subtotalCents: number): number {
  const raw = code.type === 'percentage' ? Math.round((subtotalCents * code.value) / 100) : code.value;
  return Math.min(raw, subtotalCents);
}

export interface AppliedDiscount {
  id: number;
  code: string;
  discountCents: number;
}

/**
 * Checkout: resolves the code the shopper typed against the cart subtotal, refusing it with the
 * reason when it cannot be used. The code row is locked so a concurrent deactivation waits.
 */
export async function applyAtCheckout(
  client: PoolClient,
  userId: number,
  typed: string,
  subtotalCents: number,
): Promise<AppliedDiscount> {
  const { rows } = await client.query<DiscountCodeRow & { expired: boolean }>(
    `SELECT ${COLUMNS}, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
       FROM discount_codes WHERE lower(code) = lower($1) FOR UPDATE`,
    [typed],
  );
  const row = rows[0];
  if (!row) throw badRequest('discount code does not exist');
  if (!row.active) throw badRequest(`discount code ${row.code} is no longer active`);
  if (row.expired) throw badRequest(`discount code ${row.code} has expired`);
  if (subtotalCents < row.min_subtotal_cents) {
    const min = `$${(row.min_subtotal_cents / 100).toFixed(2)}`;
    throw badRequest(`discount code ${row.code} requires a cart subtotal of at least ${min}`);
  }
  const used = await client.query(
    `SELECT 1 FROM orders WHERE user_id = $1 AND discount_code_id = $2 AND status <> 'cancelled' LIMIT 1`,
    [userId, row.id],
  );
  if (used.rows.length > 0) throw conflict(`discount code ${row.code} has already been used on another order`);

  return { id: row.id, code: row.code, discountCents: discountFor(row, subtotalCents) };
}
