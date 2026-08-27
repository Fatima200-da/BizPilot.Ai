import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../testing/integration-helpers';

/**
 * Phase 34 Track I: a real `curl` against the running dev server found
 * `X-Powered-By: Express` present despite helmet() being applied — a real,
 * known ordering gotcha (helmet's hidePoweredBy removes the header early in
 * the middleware chain, but Express's own res.send()/res.json() re-adds it
 * later based on the `x-powered-by` app SETTING, not the response's current
 * header state). Fixed with `app.disable('x-powered-by')` in app.ts.
 */
describe('Security headers (Phase 34 Track I)', () => {
  it('never leaks X-Powered-By: Express', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies the real Helmet security header set on every response', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['content-security-policy']).toBeTruthy();
  });

  it('CORS reflects only the configured origin, never an arbitrary attacker-supplied Origin header', async () => {
    const res = await request(app).options('/api/v1/auth/login').set('Origin', 'https://evil-attacker.example').set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil-attacker.example');
  });
});
