import { Request, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { notFound } from '../errors';
import { currentUser, requireAuth, requireStaff } from '../middleware/auth';
import { parseId } from '../validation';
import * as service from './service';

export const ordersRouter = Router();

function orderId(req: Request): number {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('order not found');
  return id;
}

ordersRouter.post(
  '/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json({ order: await service.checkout(currentUser(req).id) });
  }),
);

ordersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ orders: await service.listForUser(currentUser(req).id) });
  }),
);

ordersRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ order: await service.getForUser(currentUser(req).id, orderId(req)) });
  }),
);

ordersRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ order: await service.cancel(currentUser(req).id, orderId(req)) });
  }),
);

ordersRouter.post(
  '/:id/ship',
  requireStaff,
  asyncHandler(async (req, res) => {
    res.json({ order: await service.ship(orderId(req)) });
  }),
);
