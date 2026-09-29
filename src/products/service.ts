import { pool } from '../db';
import { notFound } from '../errors';

export const PAGE_SIZE = 20;

export interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  inStock: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow {
  id: number;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name, description, category, price_cents, stock, active, created_at, updated_at';

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    stock: row.stock,
    inStock: row.active && row.stock > 0,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ListQuery {
  page: number;
  category?: string;
  search?: string;
}

export async function listActive(query: ListQuery) {
  const where = ['active = TRUE'];
  const params: unknown[] = [];
  if (query.category) {
    params.push(query.category);
    where.push(`lower(category) = lower($${params.length})`);
  }
  if (query.search) {
    params.push(`%${escapeLike(query.search)}%`);
    where.push(`name ILIKE $${params.length}`);
  }
  const whereSql = where.join(' AND ');

  const countResult = await pool.query<{ count: string }>(`SELECT count(*) FROM products WHERE ${whereSql}`, params);
  const total = Number(countResult.rows[0].count);

  const offset = (query.page - 1) * PAGE_SIZE;
  const { rows } = await pool.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
    [...params, offset],
  );
  return {
    products: rows.map(toProduct),
    page: query.page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export async function getById(id: number, opts: { includeInactive: boolean }): Promise<Product> {
  const { rows } = await pool.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row || (!row.active && !opts.includeInactive)) throw notFound('product not found');
  return toProduct(row);
}

export interface ProductInput {
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
}

export async function create(input: ProductInput): Promise<Product> {
  const { rows } = await pool.query<ProductRow>(
    `INSERT INTO products (name, description, category, price_cents, stock)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [input.name, input.description, input.category, input.priceCents, input.stock],
  );
  return toProduct(rows[0]);
}

export type ProductPatch = Partial<ProductInput> & { active?: boolean };

const PATCH_COLUMNS: Record<keyof ProductPatch, string> = {
  name: 'name',
  description: 'description',
  category: 'category',
  priceCents: 'price_cents',
  stock: 'stock',
  active: 'active',
};

export async function update(id: number, patch: ProductPatch): Promise<Product> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof ProductPatch)[]) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
    }
  }
  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<ProductRow>(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  );
  if (rows.length === 0) throw notFound('product not found');
  return toProduct(rows[0]);
}

export async function deactivate(id: number): Promise<Product> {
  return update(id, { active: false });
}
