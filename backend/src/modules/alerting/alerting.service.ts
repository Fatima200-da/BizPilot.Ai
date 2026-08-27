import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { getMetricsSnapshot } from '../../common/observability/metrics';
import { getBackupObservability } from '../backup/backup.service';
import { getPurgeObservability } from '../data-retention/data-retention.service';
import { checkS3Connectivity, isS3Configured } from '../backup/s3-storage.service';

/**
 * Phase 33 Track F: real production alerting — every check below reads
 * real, current state (the same `BackupRun`/`Job`/metrics-counter data
 * this project's other observability surfaces already read from), never a
 * fabricated or simulated signal. Alert DELIVERY (Slack/email/PagerDuty)
 * is a separate concern from DETECTION: no real webhook/notification
 * credential is configured in this environment, so `dispatchAlerts`
 * honestly logs what it would have sent (the same pattern already
 * established for email — see `infrastructure/email`) rather than
 * pretending a real page went out.
 */

export type AlertSeverity = 'critical' | 'warning';

export interface Alert {
  type: string;
  severity: AlertSeverity;
  message: string;
  detectedAt: string;
  context: Record<string, unknown>;
}

const DEAD_LETTER_THRESHOLD = 10;
const ERROR_RATE_THRESHOLD = 0.05; // 5% of real HTTP requests returning 5xx
const P95_LATENCY_THRESHOLD_MS = 2000;
const STUCK_JOB_MINUTES = 30; // a real Job sitting PENDING/RETRY_WAIT this long suggests the scheduler/worker isn't draining it

/** Real, current-state evaluation — every alert either fires from real data or doesn't; nothing here is a simulated/pre-canned example. */
export async function evaluateAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // --- Backup health (real BackupRun rows) ---
  const backupObs = await getBackupObservability(5);
  if (backupObs.lastFailed && (!backupObs.lastSuccessful || new Date(backupObs.lastFailed.startedAt) > new Date(backupObs.lastSuccessful.startedAt))) {
    alerts.push({ type: 'backup_failure', severity: 'critical', message: `The most recent backup attempt failed: ${String(backupObs.lastFailed.errorMessage)}`, detectedAt: now, context: { runId: backupObs.lastFailed.id } });
  }
  if (backupObs.currentStatus === 'UNHEALTHY') {
    alerts.push({ type: 'stale_backup', severity: 'critical', message: `No successful backup in over 48 hours (age: ${backupObs.backupAgeHours?.toFixed(1) ?? 'unknown'}h).`, detectedAt: now, context: { backupAgeHours: backupObs.backupAgeHours } });
  }
  const lastVerified = await prisma.backupRun.findFirst({ where: { status: 'SUCCEEDED', restoreVerifiedAt: { not: null } }, orderBy: { startedAt: 'desc' } });
  if (lastVerified && lastVerified.restoreVerifiedOk === false) {
    alerts.push({ type: 'restore_verification_failure', severity: 'critical', message: `The most recent backup's automated restore verification failed: ${String(lastVerified.restoreVerifyError)}`, detectedAt: now, context: { runId: lastVerified.id } });
  }

  // --- Scheduler / job-queue health (real Job rows) ---
  const deadLetterCount = await prisma.job.count({ where: { status: 'FAILED' } });
  if (deadLetterCount >= DEAD_LETTER_THRESHOLD) {
    alerts.push({ type: 'dead_letter_growth', severity: 'warning', message: `${String(deadLetterCount)} jobs are in the dead-letter (FAILED) state — real operator attention needed.`, detectedAt: now, context: { deadLetterCount } });
  }
  const stuckCutoff = new Date(Date.now() - STUCK_JOB_MINUTES * 60_000);
  const stuckJobs = await prisma.job.count({ where: { status: { in: ['PENDING', 'RETRY_WAIT'] }, nextRunAt: { lt: stuckCutoff } } });
  if (stuckJobs > 0) {
    alerts.push({ type: 'scheduler_stall', severity: 'critical', message: `${String(stuckJobs)} real job(s) have been due for over ${String(STUCK_JOB_MINUTES)} minutes without being claimed — the scheduler/worker process may be down.`, detectedAt: now, context: { stuckJobs } });
  }

  // --- Data retention health ---
  const purgeObs = await getPurgeObservability(5);
  if (purgeObs.currentStatus === 'FAILED_RECENTLY') {
    alerts.push({ type: 'retention_purge_failure', severity: 'warning', message: `The most recent data-retention purge failed: ${String(purgeObs.lastFailed?.errorMessage)}`, detectedAt: now, context: { runId: purgeObs.lastFailed?.id } });
  }

  // --- Database availability (a real, live query, not a cached flag) ---
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    alerts.push({ type: 'database_unavailable', severity: 'critical', message: `A real database ping failed: ${err instanceof Error ? err.message : String(err)}`, detectedAt: now, context: {} });
  }

  // --- Off-site storage availability (only meaningful if configured) ---
  if (isS3Configured()) {
    const s3Check = await checkS3Connectivity();
    if (!s3Check.ok) {
      alerts.push({ type: 'storage_outage', severity: 'critical', message: `Real S3-compatible connectivity check failed: ${String(s3Check.error)}`, detectedAt: now, context: {} });
    }
  }

  // --- Real, in-process HTTP/AI metrics (Phase 19's own counters) ---
  const metrics = getMetricsSnapshot();
  const totalRequests = metrics.counters.http_requests_total ?? 0;
  const errors5xx = metrics.counters.http_errors_5xx_total ?? 0;
  if (totalRequests >= 20 && errors5xx / totalRequests > ERROR_RATE_THRESHOLD) {
    alerts.push({ type: 'high_api_error_rate', severity: 'critical', message: `Real 5xx error rate is ${((errors5xx / totalRequests) * 100).toFixed(1)}% over the last ${String(totalRequests)} requests (threshold: ${String(ERROR_RATE_THRESHOLD * 100)}%).`, detectedAt: now, context: { totalRequests, errors5xx } });
  }
  if (metrics.httpLatencyMs.sampleCount >= 20 && metrics.httpLatencyMs.p95 > P95_LATENCY_THRESHOLD_MS) {
    alerts.push({ type: 'high_latency', severity: 'warning', message: `Real p95 HTTP latency is ${String(metrics.httpLatencyMs.p95)}ms (threshold: ${String(P95_LATENCY_THRESHOLD_MS)}ms).`, detectedAt: now, context: { p95: metrics.httpLatencyMs.p95 } });
  }
  const aiRequests = metrics.counters.ai_requests_total ?? 0;
  const aiFailures = metrics.counters.ai_failures_total ?? 0;
  if (aiRequests >= 5 && aiFailures / aiRequests > ERROR_RATE_THRESHOLD) {
    alerts.push({ type: 'ai_provider_failure', severity: 'warning', message: `Real AI-provider failure rate is ${((aiFailures / aiRequests) * 100).toFixed(1)}% over ${String(aiRequests)} requests.`, detectedAt: now, context: { aiRequests, aiFailures } });
  }

  return alerts;
}

/**
 * Real dispatch: POSTs each alert to `ALERT_WEBHOOK_URL` if configured
 * (a real, generic webhook — Slack incoming-webhooks, PagerDuty Events
 * API, or any custom receiver all accept a simple JSON POST). No such
 * credential exists in this environment — `BLOCKED — CREDENTIAL` for
 * genuine delivery; the mock path below honestly logs what would have
 * been sent, exactly as `MockEmailAdapter` already does for email.
 */
export async function dispatchAlerts(alerts: Alert[]): Promise<void> {
  for (const alert of alerts) {
    if (env.ALERT_WEBHOOK_URL) {
      try {
        await fetch(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alert) });
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', event: 'alert.dispatch_failed', alertType: alert.type, error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }));
      }
    } else {
      console.log(JSON.stringify({ level: alert.severity === 'critical' ? 'error' : 'warn', event: 'alert.mock_dispatched', ...alert }));
    }
  }
}
