# Harbor Market API

REST API for the Harbor Market store: shopper accounts, product catalog, cart, checkout and orders.
Node 20, TypeScript, Express 4 and PostgreSQL. All money values are integer cents.

## Running

| Variable       | Required | Default | Purpose                         |
| -------------- | -------- | ------- | ------------------------------- |
| `PORT`         | no       | `3000`  | HTTP port                       |
| `DATABASE_URL` | yes      |         | PostgreSQL connection string    |
| `JWT_SECRET`   | yes      |         | Secret used to sign access tokens |

```sh
npm install
npm run build
DATABASE_URL=postgres://user:pass@localhost:5432/harbor JWT_SECRET=change-me npm start
# or, with reload: npm run dev
```

On startup the server applies `db/schema.sql` if any of its tables are missing.

Docker: `docker build -t harbor-market-api .` then run with the same environment variables.

Staff accounts cannot be created through the API; insert them directly (role `staff`, bcrypt password hash).

## Conventions

- Authenticated requests send `Authorization: Bearer <token>`. Tokens expire after 24 hours.
- Errors are JSON `{ "error": "<message>" }`: 400 validation, 401 missing/invalid token or bad
  credentials, 403 not staff, 404 not found, 409 conflict (duplicate email or discount code, not enough
  stock, invalid order state, discount code already used).

## Endpoints

### Accounts

| Method | Path             | Auth | Notes |
| ------ | ---------------- | ---- | ----- |
| POST   | `/auth/register` | -    | `{ email, name, password }`; password at least 8 characters; email unique, case-insensitive. 201 `{ user }` |
| POST   | `/auth/login`    | -    | `{ email, password }` → `{ token, expiresIn, user }` |
| GET    | `/auth/me`       | user | `{ user }` |

### Catalog

| Method | Path            | Auth  | Notes |
| ------ | --------------- | ----- | ----- |
| GET    | `/products`     | -     | Active products, newest first, 20 per page. Query: `page` (default 1), `category` (exact, case-insensitive), `search` (substring of name, case-insensitive). → `{ products, page, pageSize, total, totalPages }` |
| GET    | `/products/:id` | -     | `{ product }` including `stock` and `inStock`. Inactive products are 404 (visible to staff). |
| POST   | `/products`     | staff | `{ name, description?, category, priceCents (>0), stock (>=0) }` → 201 |
| PATCH  | `/products/:id` | staff | Any of `name, description, category, priceCents, stock, active` |
| DELETE | `/products/:id` | staff | Deactivates (soft delete); the product leaves the catalog and cannot be added to carts |

### Cart

| Method | Path                       | Auth | Notes |
| ------ | -------------------------- | ---- | ----- |
| GET    | `/cart`                    | user | `{ cart: { lines[], itemCount, subtotalCents } }`; each line has `unitPriceCents`, `quantity`, `lineTotalCents`, `available` |
| POST   | `/cart/items`              | user | `{ productId, quantity }`; adds to an existing line. Line quantity 1–10 and never above stock |
| PATCH  | `/cart/items/:productId`   | user | `{ quantity }` sets the line quantity |
| DELETE | `/cart/items/:productId`   | user | Removes the line |

### Orders

| Method | Path                  | Auth  | Notes |
| ------ | --------------------- | ----- | ----- |
| POST   | `/orders/checkout`    | user  | Body optional: `{ discountCode? }`. One transaction: re-checks stock, applies the discount code if given, reduces stock, creates the order, empties the cart. Shipping 599 when the discounted subtotal is under 5000, free at 5000+. 400 empty cart or refused code, 409 if any line is unavailable or the shopper already used the code. A refused checkout changes nothing. 201 `{ order }` |
| GET    | `/orders`             | user  | Own orders, newest first |
| GET    | `/orders/:id`         | user  | Own order only (404 otherwise) |
| POST   | `/orders/:id/cancel`  | user  | Only while `placed`; returns stock |
| POST   | `/orders/:id/ship`    | staff | `placed` → `shipped` |

Order: `{ id, userId, status, items[], subtotalCents, discountCode, discountCents, shippingCents, totalCents, createdAt, updatedAt }`,
status is `placed`, `shipped` or `cancelled`. `subtotalCents` is the cart subtotal before the discount;
`discountCode` is the code as staff created it (`null` without one) and `discountCents` the amount taken off (0 without one);
`totalCents = subtotalCents - discountCents + shippingCents`.

### Discount codes

| Method | Path                            | Auth  | Notes |
| ------ | ------------------------------- | ----- | ----- |
| POST   | `/discount-codes`               | staff | `{ code, type, value, minSubtotalCents?, expiresAt? }` → 201 `{ discountCode }`. 409 if the code exists (case-insensitive) |
| GET    | `/discount-codes`               | staff | All codes, newest first → `{ discountCodes }` |
| POST   | `/discount-codes/:id/deactivate` | staff | Deactivates the code; it can no longer be used at checkout → `{ discountCode }` |

- `code`: letters and digits, 1–20 characters, unique ignoring case. Shoppers' input is matched ignoring case.
- `type` `percentage`: `value` is a whole percent, 1–50, of the cart subtotal (rounded to the nearest cent).
  `type` `fixed`: `value` is whole cents, at least 1.
- `minSubtotalCents` (default 0): the cart subtotal before the discount must be at least this.
- `expiresAt` (default `null`, no expiry): a date `YYYY-MM-DD` (usable through the end of that day, UTC) or an ISO 8601
  timestamp with a time zone (usable until that instant). Must be in the future.
- The discount never takes the subtotal below zero.
- Each shopper can use a code once; an order that is cancelled frees the code for that shopper again.

Discount code: `{ id, code, type, value, minSubtotalCents, expiresAt, active, timesUsed, createdAt, updatedAt }`;
`timesUsed` counts orders that are not cancelled.

Checkout refusals for a code: 400 `discount code does not exist`, `discount code X is no longer active`,
`discount code X has expired`, `discount code X requires a cart subtotal of at least $N.NN`;
409 `discount code X has already been used on another order`.

### Health

`GET /health` → `{ "status": "ok" }` (503 if the database is unreachable).
