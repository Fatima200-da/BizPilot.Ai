# Observability Runbook

## What exists today (VERIFIED, Phase 19)

### Structured request logs
One JSON line per request via `backend/src/common/middlewares/request-logger.ts`: `level`, `requestId`, `method`, `route`, `status`, `durationMs`, `workspaceId`/`userId` (only once authentication resolves), `workflowInstanceId` (where applicable), `timestamp`. Written to stdout — in any real deployment this should be piped to a log aggregator (not yet wired to one; see Deferred below).

**Never logged, verified by code inspection**: passwords, JWTs, cookies, API keys, database connection strings, raw request/response bodies. The logger only ever reads response metadata (status, timing) and the already-resolved `req.auth` object's IDs, never `req.body`.

### `GET /metrics`
New this phase (`backend/src/common/observability/metrics.ts`). In-memory counters and a bounded (2000-sample ring buffer) latency histogram, reset on process restart — this is the honestly-scoped behavior for a single-instance MVP with no external time-series database, not a bug. Returns:

```json
{
  "uptimeSeconds": 8,
  "counters": {
    "http_requests_total": 1,
    "http_errors_4xx_total": 1,
    "authentication_failures_total": 1
  },
  "httpLatencyMs": { "p50": 75, "p95": 75, "sampleCount": 1 }
}
```

Counters tracked: `http_requests_total`, `http_errors_4xx_total`, `http_errors_5xx_total`, `workflow_executions_total`, `workflow_failures_total`, `ai_requests_total`, `ai_failures_total`, `database_errors_total`, `authentication_failures_total`.

**This endpoint is unauthenticated but is meant to be firewalled/internal-only in any real deployment** — it is operational data (aggregate counts only, never customer data), not a customer-facing API. Route it behind an internal network / reverse-proxy allowlist, the same operational category as `/health/live` and `/health/ready`.

### Health model
- `GET /health/live` — process-alive only, no dependency checks. Used by the Docker `HEALTHCHECK` (`backend/Dockerfile`).
- `GET /health/ready` — actually pings the database (`SELECT 1`); returns `503 {"status":"unavailable","database":"unreachable"}` on failure, `200 {"status":"ok","database":"reachable"}` on success. **Re-verified this phase against a genuinely unreachable Postgres address** (not just "PGlite adapter off") — confirmed correct 503 with zero internal detail leaked.

## Alert conditions (defined, not yet wired to a paging system — DEFERRED)

| Condition | Threshold | Why |
|---|---|---|
| `http_errors_5xx_total` rate | >1% of `http_requests_total` over 5 min | Real customer-facing failures |
| `/health/ready` returning 503 | any occurrence, sustained >30s | Database unreachable — see DISASTER_RECOVERY_RUNBOOK.md |
| `authentication_failures_total` rate | sudden spike (>5x rolling baseline) | Possible credential-stuffing attempt — cross-check with rate-limit 429 counts |
| `workflow_failures_total` / `workflow_executions_total` ratio | >10% over 1 hour | AI provider or engine regression |
| `ai_failures_total` rate | >20% of `ai_requests_total` over 15 min | Upstream AI provider outage — see AI provider BLOCKED status before assuming a bug |
| p95 HTTP latency | >2s sustained | Real user-facing slowness — compare against the Phase 19 baseline (p95 124.7ms on the PGlite-native path; a real deployment's true baseline must be re-measured against real Postgres, Section D of the record doc) |

**No alerting/paging integration exists yet** (no PagerDuty/Opsgenie/Slack webhook wired to these conditions) — DEFERRED. The table above defines what *should* trigger an alert once one exists; do not claim alerting is active.

## Deferred (explicitly, not silently)

- No external log aggregation (stdout only — fine for a single Docker container with `docker logs`, insufficient once there is more than one instance).
- No distributed tracing (not needed at current architecture — one process, no service-to-service calls beyond the AI provider and the database).
- No dashboard (Grafana/Datadog/etc.) — `/metrics` returns JSON, not Prometheus exposition format; wiring either is future work, not attempted this phase (would be premature infrastructure for a pre-first-customer MVP, per this phase's own explicit "do not over-engineer" instruction).
