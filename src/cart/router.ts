import { Request, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { notFound } from '../errors';
import { currentUser, requireAuth } from '../middleware/auth';
import { asBody, integerField, parseId } from '../validation';
import * as service from './service';

export const cartRouter = Router();

cartRouter.use(requireAuth);

function quantity(body: Record<string, unknown>): number {
  return integerField(body, 'quantity', {
    min: service.MIN_QUANTITY,
    max: service.MAX_QUANTITY,
    required: true,
  }) as number;
}

function productIdParam(req: Request): number {
  const id = parseId(req.params.productId);
  if (id === null) throw notFound('product not in cart');
  return id;
}

cartRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ cart: await service.getCart(currentUser(req).id) });
  }),
);

cartRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const body = asBody(req.body);
    const productId = integerField(body, 'productId', { min: 1, max: 2147483647, required: true }) as number;
    const cart = await service.addItem(currentUser(req).id, productId, quantity(body));
    res.status(200).json({ cart });
  }),
);

cartRouter.patch(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    const productId = productIdParam(req);
    const body = asBody(req.body);
    res.json({ cart: await service.setQuantity(currentUser(req).id, productId, quantity(body)) });
  }),
);

cartRouter.delete(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    res.json({ cart: await service.removeItem(currentUser(req).id, productIdParam(req)) });
  }),
);
