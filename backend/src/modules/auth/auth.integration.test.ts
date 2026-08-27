import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, cleanupTestUser, data, ensureSeeded, errorBody, uniqueEmail } from '../../testing/integration-helpers';
import { env } from '../../config/env';

interface AuthResponseData {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; passwordHash?: string };
}
interface WorkspaceListData {
  id: string;
}

/**
 * Phase 16 Section 6: real authentication flow against a real database.
 * Requires DATABASE_URL pointed at a migrated, real PostgreSQL instance —
 * see vitest.integration.config.ts's doc comment for exact preconditions.
 */
describe('Authentication (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  const emails: string[] = [];
  afterAll(async () => {
    for (const email of emails) await cleanupTestUser(email);
  });

  it('POST /auth/register creates a real user and returns tokens', async () => {
    const email = uniqueEmail('register');
    emails.push(email);

    const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'Real User' });

    expect(res.status).toBe(201);
    const body = data<AuthResponseData>(res);
    expect(body.user.email).toBe(email);
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    // Section 6: password hashing — the response must never echo it back.
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email with 409, not a raw DB constraint error', async () => {
    const email = uniqueEmail('duplicate');
    emails.push(email);
    await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'First' });

    const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'Second' });

    expect(res.status).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT_DUPLICATE_EMAIL');
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|constraint/i); // Section 16: never leak internals
  });

  it('POST /auth/login returns valid tokens for correct credentials', async () => {
    const email = uniqueEmail('login');
    emails.push(email);
    await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'Login User' });

    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'password1234' });

    expect(res.status).toBe(200);
    expect(data<AuthResponseData>(res).accessToken).toBeTypeOf('string');
  });

  it('rejects invalid credentials without revealing whether the email exists', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nobody-real@example.test', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects a protected request with no token', async () => {
    const res = await request(app).get('/api/v1/workspaces');
    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe('AUTH_REQUIRED');
  });

  it('rejects a protected request with a malformed token', async () => {
    const res = await request(app).get('/api/v1/workspaces').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rejects a protected request with an expired token (distinct from merely invalid)', async () => {
    // Signed with the real, correct secret — only the expiry is in the past.
    // Proves auth.ts distinguishes jwt.TokenExpiredError from a generic
    // verification failure, not just that "some token was rejected".
    const expiredToken = jwt.sign({ sub: 'test-user-id', isSystemAdmin: false, type: 'access' }, env.JWT_SECRET, { expiresIn: '-10s' });
    const res = await request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('allows an authenticated request to access its own resources', async () => {
    const email = uniqueEmail('protected');
    emails.push(email);
    const register = await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'Protected User' });
    const token = data<AuthResponseData>(register).accessToken;

    const res = await request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(data<WorkspaceListData[]>(res))).toBe(true);
  });
});
