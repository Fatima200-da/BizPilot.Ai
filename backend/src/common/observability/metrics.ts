/**
 * Phase 19 Section 12: a minimum-viable in-memory metrics layer — not a
 * platform (no Prometheus/StatsD dependency, no external time-series
 * store). Deliberately scoped to what a single-instance MVP actually needs:
 * counters and a simple latency histogram, readable via GET /metrics (see
 * docs/OBSERVABILITY_RUNBOOK.md — this endpoint is meant to be
 * firewalled/internal-only in a real deployment, not customer-facing).
 *
 * State resets on process restart, which is the correct, honestly-scoped
 * behavior for an MVP with no external metrics backend: these numbers
 * describe "since this instance last started", not a durable time series.
 */

interface Counter {
  value: number;
}

const counters = new Map<string, Counter>();
const latencySamplesMs: number[] = [];
const MAX_LATENCY_SAMPLES = 2000; // bounded ring buffer — never unbounded memory growth

function increment(name: string, by = 1): void {
  const existing = counters.get(name);
  if (existing) {
    existing.value += by;
  } else {
    counters.set(name, { value: by });
  }
}

export function recordHttpRequest(statusCode: number, durationMs: number): void {
  increment('http_requests_total');
  if (statusCode >= 500) increment('http_errors_5xx_total');
  else if (statusCode >= 400) increment('http_errors_4xx_total');

  latencySamplesMs.push(durationMs);
  if (latencySamplesMs.length > MAX_LATENCY_SAMPLES) latencySamplesMs.shift();
}

export function recordWorkflowExecution(outcome: 'succeeded' | 'failed'): void {
  increment('workflow_executions_total');
  if (outcome === 'failed') increment('workflow_failures_total');
}

/** Phase 29 Section 8: reliability-intelligence counters distinct from the raw execution outcome above — a manual admin/customer-initiated retry of a dead-lettered instance, tracked separately from the automatic step-level retry-with-backoff `runStepWithRetry` already performs internally. */
export function recordWorkflowRetry(): void {
  increment('workflow_retries_total');
}

export function recordAiRequest(outcome: 'succeeded' | 'failed'): void {
  increment('ai_requests_total');
  if (outcome === 'failed') increment('ai_failures_total');
}

export function recordDatabaseError(): void {
  increment('database_errors_total');
}

export function recordAuthFailure(): void {
  increment('authentication_failures_total');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] ?? 0);
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  counters: Record<string, number>;
  httpLatencyMs: { p50: number; p95: number; sampleCount: number };
}

const processStart = Date.now();

export function getMetricsSnapshot(): MetricsSnapshot {
  const sorted = [...latencySamplesMs].sort((a, b) => a - b);
  const counterEntries: Record<string, number> = {};
  for (const [key, counter] of counters.entries()) counterEntries[key] = counter.value;

  return {
    uptimeSeconds: Math.round((Date.now() - processStart) / 1000),
    counters: counterEntries,
    httpLatencyMs: { p50: percentile(sorted, 50), p95: percentile(sorted, 95), sampleCount: sorted.length },
  };
}
