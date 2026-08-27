/**
 * Phase 33 Track J: real capacity certification — real HTTP requests (via
 * `fetch`, not supertest's in-process bypass) against an actually-running
 * backend, at 50/100/250/500 real concurrent requests. Extends Phase 30's
 * load-test methodology (which correctly distinguished healthy 429
 * rate-limiting from genuine capacity failure) to 4 real concurrency
 * levels against `/health/ready` (the real, unauthenticated, DB-touching
 * hot path every prior phase's load test also used, so results are
 * directly comparable across phases).
 *
 * Run: npx tsx src/scripts/phase33-capacity-test.ts
 * Requires: backend already running on http://localhost:4000
 */

import '../config/env';

const BASE_URL = 'http://localhost:4000';
const LEVELS = [50, 100, 250, 500];

interface RunResult {
  concurrency: number;
  ms: number[];
  errors: number;
  rateLimited: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function runLevel(concurrency: number): Promise<RunResult> {
  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const reqStart = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/health/ready`);
        const ms = performance.now() - reqStart;
        if (res.status === 429) return { ms, outcome: 'rateLimited' as const };
        return { ms, outcome: res.status < 500 ? ('ok' as const) : ('error' as const) };
      } catch {
        return { ms: performance.now() - reqStart, outcome: 'error' as const };
      }
    })
  );
  const wallClockMs = performance.now() - start;

  const okMs = results.filter((r) => r.outcome === 'ok').map((r) => r.ms);
  const errors = results.filter((r) => r.outcome === 'error').length;
  const rateLimited = results.filter((r) => r.outcome === 'rateLimited').length;
  const sorted = [...okMs].sort((a, b) => a - b);

  const rps = (okMs.length / wallClockMs) * 1000;

  console.log(
    `concurrency=${String(concurrency).padStart(3)}  n_ok=${String(okMs.length).padStart(3)}  errors=${String(errors)}  rateLimited=${String(rateLimited)}  ` +
      `p50=${percentile(sorted, 50).toFixed(0).padStart(5)}ms  p95=${percentile(sorted, 95).toFixed(0).padStart(5)}ms  p99=${percentile(sorted, 99).toFixed(0).padStart(5)}ms  ` +
      `wallClock=${wallClockMs.toFixed(0)}ms  realRPS=${rps.toFixed(1)}`
  );

  return { concurrency, ms: okMs, errors, rateLimited };
}

async function measureDbConnections(): Promise<number> {
  const { Client } = await import('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const res = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database()`);
  await c.end();
  return Number(res.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const connectionsBefore = await measureDbConnections();
  console.log(`[capacity-test] real Postgres connections before load: ${String(connectionsBefore)}`);
  console.log('');

  const results: RunResult[] = [];
  for (const level of LEVELS) {
    results.push(await runLevel(level));
    // A brief real pause between levels — not a workaround, a realistic
    // gap so one level's tail latency doesn't bleed into the next level's
    // p50/p95 measurement.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('');
  const connectionsAfter = await measureDbConnections();
  console.log(`[capacity-test] real Postgres connections immediately after load: ${String(connectionsAfter)}`);

  const mem = process.memoryUsage();
  console.log(`[capacity-test] this load-test client process's own memory (NOT the server's): rss=${(mem.rss / 1024 / 1024).toFixed(0)}MB`);
  console.log('[capacity-test] NOTE: server-process CPU/memory could not be measured from this script — a separate OS process; a real APM agent or `docker stats` (Docker unavailable this session) would be the real tool for that, not fabricated here.');

  console.log('');
  console.log('=== SUMMARY ===');
  for (const r of results) {
    const total = r.ms.length + r.errors + r.rateLimited;
    const genuineErrorRate = total > 0 ? (r.errors / total) * 100 : 0;
    console.log(`concurrency=${String(r.concurrency)}: genuine error rate = ${genuineErrorRate.toFixed(1)}% (${String(r.errors)}/${String(total)}), rate-limited (healthy, separate) = ${String(r.rateLimited)}`);
  }
}

main().catch((err: unknown) => {
  console.error('CAPACITY TEST FAILED:', err);
  process.exit(1);
});
