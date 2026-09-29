import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 10;

export interface CartLine {
  productId: number;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  available: boolean;
}

export interface Cart {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
}

interface LineRow {
  product_id: number;
  name: string;
  category: string;
  price_cents: number;
  quantity: number;
  stock: number;
  active: boolean;
}

export async function getCart(userId: number): Promise<Cart> {
  const { rows } = await pool.query<LineRow>(
    `SELECT c.product_id, p.name, p.category, p.price_cents, c.quantity, p.stock, p.active
       FROM cart_items c JOIN products p ON p.id = c.product_id
      WHERE c.user_id = $1
      ORDER BY c.created_at, c.product_id`,
    [userId],
  );
  const lines = rows.map<CartLine>((r) => ({
    productId: r.product_id,
    name: r.name,
    category: r.category,
    unitPriceCents: r.price_cents,
    quantity: r.quantity,
    lineTotalCents: r.price_cents * r.quantity,
    available: r.active && r.stock >= r.quantity,
  }));
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
  };
}

async function lockActiveProduct(client: PoolClient, productId: number): Promise<{ stock: number }> {
  const { rows } = await client.query<{ stock: number; active: boolean }>(
    'SELECT stock, active FROM products WHERE id = $1 FOR UPDATE',
    [productId],
  );
  if (rows.length === 0 || !rows[0].active) throw notFound('product not found');
  return rows[0];
}

function checkQuantity(quantity: number, stock: number): void {
  if (quantity > MAX_QUANTITY) {
    throw badRequest(`quantity per product must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}`);
  }
  if (quantity > stock) {
    throw conflict('not enough stock');
  }
}

/** Adds quantity of a product to the cart, merging with an existing line. */
export async function addItem(userId: number, productId: number, quantity: number): Promise<Cart> {
  await withTransaction(async (client) => {
    const product = await lockActiveProduct(client, productId);
    const existing = await client.query<{ quantity: number }>(
      'SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2 FOR UPDATE',
      [userId, productId],
    );
    const newQuantity = (existing.rows[0]?.quantity ?? 0) + quantity;
    checkQuantity(newQuantity, product.stock);
    await client.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [userId, productId, newQuantity],
    );
  });
  return getCart(userId);
}

/** Sets the quantity of an existing cart line. */
export async function setQuantity(userId: number, productId: number, quantity: number): Promise<Cart> {
  await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM cart_items WHERE user_id = $1 AND product_id = $2 FOR UPDATE',
      [userId, productId],
    );
    if (existing.rowCount === 0) throw notFound('product not in cart');
    const product = await lockActiveProduct(client, productId);
    checkQuantity(quantity, product.stock);
    await client.query('UPDATE cart_items SET quantity = $3 WHERE user_id = $1 AND product_id = $2', [
      userId,
      productId,
      quantity,
    ]);
  });
  return getCart(userId);
}

export async function removeItem(userId: number, productId: number): Promise<Cart> {
  const result = await pool.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [userId, productId]);
  if (result.rowCount === 0) throw notFound('product not in cart');
  return getCart(userId);
}
