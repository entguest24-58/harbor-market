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
  credentials, 403 not staff, 404 not found, 409 conflict (duplicate email, not enough stock, invalid
  order state).

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
| POST   | `/orders/checkout`    | user  | One transaction: re-checks stock, reduces it, creates the order, empties the cart. Shipping 599 under 5000 subtotal, free at 5000+. 400 empty cart, 409 if any line is unavailable. 201 `{ order }` |
| GET    | `/orders`             | user  | Own orders, newest first |
| GET    | `/orders/:id`         | user  | Own order only (404 otherwise) |
| POST   | `/orders/:id/cancel`  | user  | Only while `placed`; returns stock |
| POST   | `/orders/:id/ship`    | staff | `placed` → `shipped` |

Order: `{ id, userId, status, items[], subtotalCents, shippingCents, totalCents, createdAt, updatedAt }`,
status is `placed`, `shipped` or `cancelled`.

### Health

`GET /health` → `{ "status": "ok" }` (503 if the database is unreachable).
