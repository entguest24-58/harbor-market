import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool } from '../db';
import { forbidden, unauthorized } from '../errors';

export type Role = 'customer' | 'staff';

export interface AuthUser {
  id: number;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.tokenTtlSeconds,
    algorithm: 'HS256',
  });
}

async function authenticate(req: Request): Promise<AuthUser> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthorized();
  }
  const token = header.slice('Bearer '.length).trim();
  let userId: number;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub) throw new Error('bad payload');
    userId = Number(payload.sub);
    if (!Number.isInteger(userId)) throw new Error('bad subject');
  } catch {
    throw unauthorized('invalid or expired token');
  }
  // Role is read from the database so a role change or deleted account takes effect immediately.
  const { rows } = await pool.query<{ id: number; role: Role }>('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) {
    throw unauthorized('invalid or expired token');
  }
  return { id: rows[0].id, role: rows[0].role };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  authenticate(req)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== 'staff') return next(forbidden('staff only'));
    next();
  });
}

/** Attaches req.user when a valid token is present; never rejects the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers.authorization) return next();
  authenticate(req)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => next());
}

/** Returns the authenticated user; only call after requireAuth/requireStaff. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
