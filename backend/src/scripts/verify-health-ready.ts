/** Phase 17: quick real check that /health/ready actually pings the database rather than returning a static ok. Run with USE_PGLITE_ADAPTER=true. */
import request from 'supertest';
import { createApp } from '../app';

async function main(): Promise<void> {
  const app = createApp();
  const res = await request(app).get('/health/ready');
  const body = res.body as { status: string; database: string };
  console.log('GET /health/ready ->', res.status, JSON.stringify(body));
  if (res.status !== 200 || body.database !== 'reachable') {
    throw new Error('health/ready did not report a reachable database');
  }
  console.log('OK: /health/ready correctly reports database: reachable against a real (PGlite-backed) connection.');
}

main().catch((err: unknown) => {
  console.error('FAILED:', err);
  process.exit(1);
});
