import bcrypt from 'bcryptjs';
import { DatabaseError } from 'pg';
import { pool } from '../db';
import { conflict, notFound, unauthorized } from '../errors';
import { Role, signToken } from '../middleware/auth';

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  created_at: Date;
}

const BCRYPT_ROUNDS = 10;
// Hash used to keep sign-in timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function register(input: { email: string; name: string; password: string }): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id, email, name, role, password_hash, created_at`,
      [email, input.name, passwordHash],
    );
    return toPublic(rows[0]);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw conflict('email already registered');
    }
    throw err;
  }
}

export async function login(input: { email: string; password: string }): Promise<{ token: string; expiresIn: number; user: PublicUser }> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, name, role, password_hash, created_at FROM users WHERE lower(email) = $1',
    [normalizeEmail(input.email)],
  );
  const row = rows[0];
  const ok = await bcrypt.compare(input.password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) {
    throw unauthorized('invalid email or password');
  }
  return { token: signToken({ id: row.id, role: row.role }), expiresIn: 24 * 60 * 60, user: toPublic(row) };
}

export async function getProfile(userId: number): Promise<PublicUser> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, name, role, password_hash, created_at FROM users WHERE id = $1',
    [userId],
  );
  if (rows.length === 0) throw notFound('user not found');
  return toPublic(rows[0]);
}
