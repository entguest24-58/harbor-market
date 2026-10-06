-- Harbor Market schema. All money values are integer cents.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_active_created_idx ON products (active, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'shipped', 'cancelled')),
  subtotal_cents      INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents      INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS order_items (
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  product_name     TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents > 0),
  PRIMARY KEY (order_id, product_id)
);

-- Discount codes. Shoppers type `code`; it is matched ignoring case.
-- percentage: value is whole percent off the subtotal (1-50); fixed: value is cents off the subtotal.
CREATE TABLE IF NOT EXISTS discount_codes (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9]{1,20}$'),
  type               TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value              INTEGER NOT NULL CHECK (value > 0 AND (type <> 'percentage' OR value <= 50)),
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  expires_at         TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_code_lower_idx ON discount_codes (lower(code));

-- Discount applied to an order. subtotal_cents stays the pre-discount cart subtotal;
-- total_cents = subtotal_cents - discount_cents + shipping_cents.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code_id INTEGER REFERENCES discount_codes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);

-- A shopper may use a code once; a cancelled order frees it again.
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_discount_code_idx ON orders (user_id, discount_code_id)
  WHERE discount_code_id IS NOT NULL AND status <> 'cancelled';
