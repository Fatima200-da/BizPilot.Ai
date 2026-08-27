import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
 * Phase 34 Track A: a real defect found by auditing app.ts against the
 * documented production topology — Express never trusted the reverse
 * proxy hop nginx sits behind in production (docker-compose.prod.yml +
 * nginx.conf.template, which sets X-Forwarded-For correctly). Without
 * `app.set('trust proxy', ...)`, every real client's `req.ip` collapses to
 * nginx's own address, which would collapse every IP-keyed rate limit
 * (rate-limit.ts) onto one shared bucket. This tests the real Express
 * behavior our one-line fix in app.ts depends on, not a mock.
 */
function buildTestApp(trustProxy: number | boolean): express.Express {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req: express.Request, res: express.Response) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe('Express trust proxy configuration (Phase 34 Track A)', () => {
  it('with trust proxy disabled (0), req.ip ignores X-Forwarded-For and uses the raw socket address', async () => {
    const app = buildTestApp(0);
    const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.55');
    expect(res.status).toBe(200);
    expect((res.body as { ip: string }).ip).not.toBe('203.0.113.55');
  });

  it('with trust proxy set to 1 (matching the real nginx-in-front-of-backend topology), req.ip resolves to the real client address from X-Forwarded-For', async () => {
    const app = buildTestApp(1);
    const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.55');
    expect(res.status).toBe(200);
    expect((res.body as { ip: string }).ip).toBe('203.0.113.55');
  });

  it('with trust proxy set to 1, a second, further-upstream address in a spoofed X-Forwarded-For chain is NOT trusted — only the address adjacent to the trusted hop is used', async () => {
    const app = buildTestApp(1);
    // A client attempting to forge an arbitrary IP by prepending a fake
    // entry: real proxy chains read right-to-left (nearest hop last).
    const res = await request(app).get('/ip').set('X-Forwarded-For', '198.51.100.9, 203.0.113.55');
    expect(res.status).toBe(200);
    // Only 1 hop trusted -> the last entry (nginx's own view of the client) is used, not the attacker-controlled first entry.
    expect((res.body as { ip: string }).ip).toBe('203.0.113.55');
  });
});
