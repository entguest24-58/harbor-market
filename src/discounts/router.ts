import { Request, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { badRequest, notFound } from '../errors';
import { requireStaff } from '../middleware/auth';
import { asBody, Body, integerField, parseId, requiredString } from '../validation';
import * as service from './service';

const MAX_FIXED_CENTS = 100_000_000; // $1,000,000.00
const MAX_MIN_SUBTOTAL_CENTS = 100_000_000;

export const discountsRouter = Router();

function discountId(req: Request): number {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('discount code not found');
  return id;
}

/**
 * expiresAt: null/absent for no expiry, an ISO 8601 timestamp with a time zone (expires at that
 * instant), or a date YYYY-MM-DD (usable through the end of that day, UTC). Must be in the future.
 */
function expiresAtField(body: Body): Date | null {
  const value = body.expiresAt;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('expiresAt must be a date string or null');
  const raw = value.trim();
  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw badRequest('expiresAt must be a valid date');
    }
    date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw badRequest('expiresAt must be a valid date');
  } else {
    throw badRequest('expiresAt must be a date (YYYY-MM-DD) or an ISO 8601 timestamp with a time zone');
  }
  if (date.getTime() <= Date.now()) throw badRequest('expiresAt must be in the future');
  return date;
}

discountsRouter.post(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const body = asBody(req.body);
    const code = requiredString(body, 'code', { maxLength: 20 });
    if (!service.CODE_PATTERN.test(code)) throw badRequest('code must contain only letters and digits');

    const type = body.type;
    if (type !== 'percentage' && type !== 'fixed') throw badRequest('type must be "percentage" or "fixed"');
    const value = integerField(body, 'value', {
      min: 1,
      max: type === 'percentage' ? service.MAX_PERCENTAGE : MAX_FIXED_CENTS,
      required: true,
    }) as number;

    const discountCode = await service.create({
      code,
      type,
      value,
      minSubtotalCents: integerField(body, 'minSubtotalCents', { min: 0, max: MAX_MIN_SUBTOTAL_CENTS }) ?? 0,
      expiresAt: expiresAtField(body),
    });
    res.status(201).json({ discountCode });
  }),
);

discountsRouter.get(
  '/',
  requireStaff,
  asyncHandler(async (_req, res) => {
    res.json({ discountCodes: await service.list() });
  }),
);

discountsRouter.post(
  '/:id/deactivate',
  requireStaff,
  asyncHandler(async (req, res) => {
    res.json({ discountCode: await service.deactivate(discountId(req)) });
  }),
);
