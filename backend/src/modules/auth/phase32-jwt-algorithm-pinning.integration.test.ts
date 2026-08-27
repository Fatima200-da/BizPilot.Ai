import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { env } from '../../config/env';

/**
 * Phase 32 Track G: real algorithm-pinning verification. Real execution
 * (a standalone script, run before this test existed) already confirmed
 * the installed `jsonwebtoken` version rejects a forged `alg: none` token
 * by default — not an active vulnerability. This test proves the
 * DEFENSE-IN-DEPTH fix (explicit `algorithms: ['HS256']` on every verify
 * call, `algorithm: 'HS256'` on every sign call) actually holds: a token
 * that is validly signed with the REAL server secret, but under a
 * DIFFERENT algorithm than the one the server issues, must still be
 * rejected — proving the server pins the exact algorithm rather than
 * accepting "any algorithm the token header claims, as long as the
 * signature checks out."
 */
describe('Phase 32 Track G: JWT algorithm pinning (integration)', () => {
  it('a token validly signed with the real JWT_SECRET but under HS384 (not the server-issued HS256) is rejected', async () => {
    await ensureSeeded();
    const user = await registerTestUser('JWT Algorithm Pinning Test User');

    const wrongAlgToken = jwt.sign({ sub: user.userId, isSystemAdmin: false, type: 'access' }, env.JWT_SECRET, { algorithm: 'HS384', expiresIn: '15m' });

    const res = await request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${wrongAlgToken}`);
    expect(res.status).toBe(401); // real signature, real secret, wrong algorithm — still rejected

    const realToken = jwt.sign({ sub: user.userId, isSystemAdmin: false, type: 'access' }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
    const okRes = await request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${realToken}`);
    expect(okRes.status).toBe(200); // sanity: the real, correctly-signed algorithm still works
  });

  it('a real, correctly-issued token from the actual sign function is genuinely HS256 (not accidentally left un-pinned)', async () => {
    const user = await registerTestUser('JWT Algorithm Header Check User');
    const decoded = jwt.decode(user.accessToken, { complete: true });
    expect(decoded?.header.alg).toBe('HS256');
  });
});
