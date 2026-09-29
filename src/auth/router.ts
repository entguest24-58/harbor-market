import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { badRequest } from '../errors';
import { currentUser, requireAuth } from '../middleware/auth';
import { asBody, requiredString } from '../validation';
import * as service from './service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt only uses the first 72 bytes

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = asBody(req.body);
    const email = requiredString(body, 'email', { maxLength: 254 });
    if (!EMAIL_RE.test(email)) throw badRequest('email is invalid');
    const name = requiredString(body, 'name', { maxLength: 100 });
    const password = body.password;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw badRequest(`password must be at least ${MIN_PASSWORD} characters`);
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD) {
      throw badRequest(`password must be at most ${MAX_PASSWORD} bytes`);
    }
    const user = await service.register({ email, name, password });
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = asBody(req.body);
    const { email, password } = body;
    if (typeof email !== 'string' || email.trim() === '' || typeof password !== 'string' || password === '') {
      throw badRequest('email and password are required');
    }
    const result = await service.login({ email, password });
    res.json(result);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await service.getProfile(currentUser(req).id);
    res.json({ user });
  }),
);
