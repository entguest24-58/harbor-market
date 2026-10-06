import express, { NextFunction, Request, Response } from 'express';
import { authRouter } from './auth/router';
import { cartRouter } from './cart/router';
import { pool } from './db';
import { discountsRouter } from './discounts/router';
import { HttpError } from './errors';
import { ordersRouter } from './orders/router';
import { productsRouter } from './products/router';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ error: 'database unavailable' });
    }
  });

  app.use('/auth', authRouter);
  app.use('/products', productsRouter);
  app.use('/cart', cartRouter);
  app.use('/orders', ordersRouter);
  app.use('/discount-codes', discountsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e && e.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'malformed JSON body' });
      return;
    }
    if (e && e.type === 'entity.too.large') {
      res.status(413).json({ error: 'request body too large' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
