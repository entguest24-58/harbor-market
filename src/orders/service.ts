import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db';
import { applyAtCheckout, AppliedDiscount } from '../discounts/service';
import { badRequest, conflict, notFound } from '../errors';

export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
export const SHIPPING_FEE_CENTS = 599;

export type OrderStatus = 'placed' | 'shipped' | 'cancelled';

export interface OrderItem {
  productId: number;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Order {
  id: number;
  userId: number;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
}

interface OrderRow {
  id: number;
  user_id: number;
  status: OrderStatus;
  subtotal_cents: number;
  discount_code: string | null;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  order_id: number;
  product_id: number;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

const ORDER_COLUMNS =
  'id, user_id, status, subtotal_cents, discount_code, discount_cents, shipping_cents, total_cents, created_at, updated_at';

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_CENTS;
}

async function loadOrders(db: PoolClient | typeof pool, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const items = await db.query<ItemRow>(
    `SELECT order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents
       FROM order_items WHERE order_id = ANY($1) ORDER BY order_id, product_id`,
    [rows.map((r) => r.id)],
  );
  const byOrder = new Map<number, OrderItem[]>();
  for (const it of items.rows) {
    const list = byOrder.get(it.order_id) ?? [];
    list.push({
      productId: it.product_id,
      name: it.product_name,
      unitPriceCents: it.unit_price_cents,
      quantity: it.quantity,
      lineTotalCents: it.line_total_cents,
    });
    byOrder.set(it.order_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    status: r.status,
    items: byOrder.get(r.id) ?? [],
    subtotalCents: r.subtotal_cents,
    discountCode: r.discount_code,
    discountCents: r.discount_cents,
    shippingCents: r.shipping_cents,
    totalCents: r.total_cents,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export interface CheckoutOptions {
  /** Discount code as typed by the shopper; matched ignoring case. */
  discountCode?: string;
}

/**
 * Turns the user's cart into an order in one transaction: stock is re-checked under row locks,
 * the optional discount code is validated, stock is decremented, the order is written and the cart
 * is emptied. Any failure (including a refused code) rolls everything back.
 *
 * Totals: discount comes off the cart subtotal (never below zero); shipping is decided on the
 * discounted subtotal; total = subtotal - discount + shipping.
 */
export async function checkout(userId: number, opts: CheckoutOptions = {}): Promise<Order> {
  return withTransaction(async (client) => {
    const cart = await client.query<{ product_id: number; quantity: number }>(
      'SELECT product_id, quantity FROM cart_items WHERE user_id = $1 ORDER BY product_id FOR UPDATE',
      [userId],
    );
    if (cart.rows.length === 0) throw badRequest('cart is empty');

    // Lock product rows in id order so concurrent checkouts cannot deadlock.
    const products = await client.query<{ id: number; name: string; price_cents: number; stock: number; active: boolean }>(
      'SELECT id, name, price_cents, stock, active FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [cart.rows.map((r) => r.product_id)],
    );
    const byId = new Map(products.rows.map((p) => [p.id, p]));

    const unavailable: string[] = [];
    const lines = cart.rows.map((line) => {
      const p = byId.get(line.product_id);
      if (!p || !p.active || p.stock < line.quantity) {
        unavailable.push(p ? p.name : `product ${line.product_id}`);
      }
      return { line, product: p };
    });
    if (unavailable.length > 0) {
      throw conflict(`not enough stock for: ${unavailable.join(', ')}`);
    }

    let subtotal = 0;
    const items = lines.map(({ line, product }) => {
      const p = product!;
      const lineTotal = p.price_cents * line.quantity;
      subtotal += lineTotal;
      return { productId: p.id, name: p.name, unitPrice: p.price_cents, quantity: line.quantity, lineTotal };
    });
    const discount: AppliedDiscount | null =
      opts.discountCode !== undefined ? await applyAtCheckout(client, userId, opts.discountCode, subtotal) : null;
    const discountCents = discount ? discount.discountCents : 0;
    const discountedSubtotal = subtotal - discountCents;
    const shipping = shippingFor(discountedSubtotal);
    const total = discountedSubtotal + shipping;

    let order;
    try {
      order = await client.query<OrderRow>(
        `INSERT INTO orders (user_id, status, subtotal_cents, discount_code_id, discount_code, discount_cents,
                             shipping_cents, total_cents)
         VALUES ($1, 'placed', $2, $3, $4, $5, $6, $7) RETURNING ${ORDER_COLUMNS}`,
        [userId, subtotal, discount?.id ?? null, discount?.code ?? null, discountCents, shipping, total],
      );
    } catch (err) {
      // orders_user_discount_code_idx: a concurrent checkout by the same shopper took the code first.
      if (discount && (err as { code?: string }).code === '23505') {
        throw conflict(`discount code ${discount.code} has already been used on another order`);
      }
      throw err;
    }
    const orderId = order.rows[0].id;

    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, it.productId, it.name, it.unitPrice, it.quantity, it.lineTotal],
      );
      await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [
        it.productId,
        it.quantity,
      ]);
    }
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

    const [result] = await loadOrders(client, order.rows);
    return result;
  });
}

export async function listForUser(userId: number): Promise<Order[]> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  return loadOrders(pool, rows);
}

export async function getForUser(userId: number, orderId: number): Promise<Order> {
  const { rows } = await pool.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND user_id = $2`, [
    orderId,
    userId,
  ]);
  if (rows.length === 0) throw notFound('order not found');
  const [order] = await loadOrders(pool, rows);
  return order;
}

/**
 * Cancels one of the user's own orders while it is still placed, returning its stock. A discount
 * code on the order is freed for this shopper again (usage only counts non-cancelled orders).
 */
export async function cancel(userId: number, orderId: number): Promise<Order> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [orderId, userId],
    );
    if (rows.length === 0) throw notFound('order not found');
    if (rows[0].status !== 'placed') throw conflict(`order is ${rows[0].status} and can no longer be cancelled`);

    await client.query(
      `UPDATE products p SET stock = p.stock + oi.quantity, updated_at = now()
         FROM order_items oi WHERE oi.order_id = $1 AND p.id = oi.product_id`,
      [orderId],
    );
    const updated = await client.query<OrderRow>(
      `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING ${ORDER_COLUMNS}`,
      [orderId],
    );
    const [order] = await loadOrders(client, updated.rows);
    return order;
  });
}

/** Staff: moves any order from placed to shipped. */
export async function ship(orderId: number): Promise<Order> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [
      orderId,
    ]);
    if (rows.length === 0) throw notFound('order not found');
    if (rows[0].status !== 'placed') throw conflict(`order is ${rows[0].status} and cannot be shipped`);
    const updated = await client.query<OrderRow>(
      `UPDATE orders SET status = 'shipped', updated_at = now() WHERE id = $1 RETURNING ${ORDER_COLUMNS}`,
      [orderId],
    );
    const [order] = await loadOrders(client, updated.rows);
    return order;
  });
}
