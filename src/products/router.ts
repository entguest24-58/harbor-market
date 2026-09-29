import { Request, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { badRequest, notFound } from '../errors';
import { optionalAuth, requireStaff } from '../middleware/auth';
import { asBody, integerField, optionalString, parseId, requiredString } from '../validation';
import * as service from './service';

const MAX_PRICE_CENTS = 100_000_000; // $1,000,000.00
const MAX_STOCK = 1_000_000;

export const productsRouter = Router();

function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw badRequest(`${name} must be a single value`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function productId(req: Request): number {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('product not found');
  return id;
}

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pageRaw = queryString(req, 'page');
    let page = 1;
    if (pageRaw !== undefined) {
      if (!/^\d+$/.test(pageRaw) || Number(pageRaw) < 1 || !Number.isSafeInteger(Number(pageRaw))) {
        throw badRequest('page must be a whole number of at least 1');
      }
      page = Number(pageRaw);
    }
    const category = queryString(req, 'category');
    const search = queryString(req, 'search') ?? queryString(req, 'q');
    if (search !== undefined && search.length > 100) throw badRequest('search must be at most 100 characters');
    res.json(await service.listActive({ page, category, search }));
  }),
);

productsRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const product = await service.getById(productId(req), { includeInactive: req.user?.role === 'staff' });
    res.json({ product });
  }),
);

productsRouter.post(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const body = asBody(req.body);
    const product = await service.create({
      name: requiredString(body, 'name', { maxLength: 200 }),
      description: optionalString(body, 'description', { maxLength: 5000, allowEmpty: true }) ?? '',
      category: requiredString(body, 'category', { maxLength: 100 }),
      priceCents: integerField(body, 'priceCents', { min: 1, max: MAX_PRICE_CENTS, required: true }) as number,
      stock: integerField(body, 'stock', { min: 0, max: MAX_STOCK, required: true }) as number,
    });
    res.status(201).json({ product });
  }),
);

productsRouter.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = productId(req);
    const body = asBody(req.body);
    const allowed = new Set(['name', 'description', 'category', 'priceCents', 'stock', 'active']);
    const unknown = Object.keys(body).filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw badRequest(`unknown field: ${unknown[0]}`);
    if (body.active !== undefined && typeof body.active !== 'boolean') throw badRequest('active must be a boolean');

    const patch: service.ProductPatch = {
      name: optionalString(body, 'name', { maxLength: 200 }),
      description: optionalString(body, 'description', { maxLength: 5000, allowEmpty: true }),
      category: optionalString(body, 'category', { maxLength: 100 }),
      priceCents: integerField(body, 'priceCents', { min: 1, max: MAX_PRICE_CENTS }),
      stock: integerField(body, 'stock', { min: 0, max: MAX_STOCK }),
      active: body.active as boolean | undefined,
    };
    if (Object.values(patch).every((v) => v === undefined)) throw badRequest('no fields to update');
    res.json({ product: await service.update(id, patch) });
  }),
);

productsRouter.delete(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    res.json({ product: await service.deactivate(productId(req)) });
  }),
);
