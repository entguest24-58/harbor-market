import { badRequest } from './errors';

export type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('request body must be a JSON object');
  }
  return value as Body;
}

export function requiredString(body: Body, field: string, opts: { maxLength?: number } = {}): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required`);
  }
  const trimmed = value.trim();
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    throw badRequest(`${field} must be at most ${opts.maxLength} characters`);
  }
  return trimmed;
}

export function optionalString(body: Body, field: string, opts: { maxLength?: number; allowEmpty?: boolean } = {}): string | undefined {
  if (body[field] === undefined) return undefined;
  const value = body[field];
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!opts.allowEmpty && trimmed === '') {
    throw badRequest(`${field} must not be empty`);
  }
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    throw badRequest(`${field} must be at most ${opts.maxLength} characters`);
  }
  return trimmed;
}

export function integerField(body: Body, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | undefined {
  const value = body[field];
  if (value === undefined) {
    if (opts.required) throw badRequest(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw badRequest(`${field} must be a whole number`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw badRequest(`${field} must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max}`);
  }
  return value;
}

/** Parses a positive integer path parameter such as :id; returns null when it is not one. */
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2147483647 ? n : null;
}
