import type { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database/prisma';
import { getMetricsSnapshot } from '../../common/observability/metrics';

/** Process is up and able to serve HTTP — says nothing about dependencies. */
export function liveHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok' });
}

/**
 * Phase 16 Section 18: distinguishes "process alive" from "application
 * ready" — actually pings the database rather than returning a static ok.
 * Never exposes the connection string, credentials, or the raw driver
 * error (Section 18's "no internal diagnostics" + Section 16's "never
 * expose SQL errors" apply to health endpoints exactly as to any other).
 *
 * Phase 27 Section 17: `database` and `jobQueue` are checked and reported
 * independently, not collapsed into one boolean — a caller can distinguish
 * "the database itself is down" from "the database is up but the job-queue
 * table specifically is unreachable" (e.g. a mid-migration state). There is
 * no separately-running scheduler daemon in this codebase (honestly
 * documented elsewhere as a known limitation — no cron/worker process is
 * started anywhere) so "scheduler health" here means exactly what it can
 * honestly mean: whether the job queue's own backing table is reachable,
 * not whether a live worker process is currently polling it.
 */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const [databaseReachable, jobQueueReachable] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT 1').then(() => true).catch(() => false),
    prisma.job.count().then(() => true).catch(() => false),
  ]);

  const allReachable = databaseReachable && jobQueueReachable;
  res.status(allReachable ? 200 : 503).json({
    status: allReachable ? 'ok' : 'unavailable',
    database: databaseReachable ? 'reachable' : 'unreachable',
    jobQueue: jobQueueReachable ? 'reachable' : 'unreachable',
  });
}

/**
 * Phase 19 Section 12: intentionally unauthenticated but meant to be
 * firewalled/internal-only in a real deployment (see
 * docs/OBSERVABILITY_RUNBOOK.md) — same operational category as
 * /health/live and /health/ready, not a customer-facing API. Never
 * includes anything that could be sensitive customer data: only aggregate
 * counters and latency percentiles.
 */
export function metricsHandler(_req: Request, res: Response): void {
  res.status(200).json(getMetricsSnapshot());
}
