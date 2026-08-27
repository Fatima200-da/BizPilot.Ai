# Scheduler & Worker Recovery Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** the scheduler/worker process (`backend/src/scripts/run-scheduler.ts`) — the real, long-running process that drains the job queue (backup, data-retention purge, scheduled-workflow-run, data-export) and ticks every scheduled job's `nextRunAt`. Distinct from the API server: they are two separate real processes (see `docker-compose.prod.yml`'s `backend` vs `scheduler` services), and losing one does not take down the other.

## What "the scheduler is down" actually means

The API server keeps serving requests normally — logins, dashboard reads, manually-triggered actions all continue to work. What stops is anything that depends on the background tick loop: scheduled backups, the daily data-retention purge, scheduled-workflow runs, and any `Job` row that was `PENDING` when the process died stays `PENDING` until a scheduler process picks it up again.

## Detecting it

- `GET /admin/alerts` — a real `scheduler_stall` alert fires when a `Job`'s `nextRunAt` (or a schedule's own due time) has passed by a meaningful margin with nothing claiming it. This is the primary, automated signal.
- `GET /admin/backups` and `GET /admin/retention` — both report `currentStatus`; a backup/retention system that was healthy and has gone quiet (no new runs at the expected cadence) is a secondary signal.
- Direct query: `SELECT count(*) FROM jobs WHERE status = 'PENDING' AND "nextRunAt" < now() - interval '10 minutes';` — a real, growing count of overdue pending jobs is unambiguous.

## Recovery

1. Confirm the process is actually dead (not just slow): check your process manager/orchestrator (Docker: `docker ps` — the `scheduler` container's `Up`/`Restarting`/`Exited` state; `docker logs <scheduler-container>` for the real last lines before it stopped).
2. Restart it: `npx tsx src/scripts/run-scheduler.ts` (dev) or restart the `scheduler` container/service (production) — matches exactly `DEPLOYMENT_RUNBOOK.md`'s start step for this process.
3. **No manual reconciliation is needed for the queued work itself.** This is a deliberate, already-certified property of the job-queue design (Phase 27): every `Job` row's claim is lease-based (`claimedAt`/lease expiry), not tied to a specific process instance. A fresh scheduler process, on its first tick, will:
   - Reap any `Job` whose lease has expired (real crash-recovery — a job claimed by the dead process is picked up by the new one; the dead process's own eventual `completeJob()` call, if it ever runs, is correctly locked out — see `docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md` Track K for the real chaos test proving this for the retention-purge job type, and Phase 27's original certification for `scheduled-workflow-run`/backup).
   - Coalesce any schedule (backup, data-retention) that missed multiple runs into exactly one catch-up run, not one per missed interval (`MAX_COALESCE_ITERATIONS`-bounded — see `BACKUP_RUNBOOK.md`).
4. Verify recovery: `GET /admin/alerts` shows no `scheduler_stall` within one tick interval of the restart, and `GET /admin/backups` / `GET /admin/retention` show a fresh run once the next scheduled time (or the coalesced catch-up) arrives.

## If the scheduler keeps crashing (not just stopping)

1. Check the real crash reason in its logs — the process's own `.catch()` on the tick loop calls `process.exit(1)` on an uncaught error, so a crash-looping container is a real signal of a genuine bug, not routine restart churn.
2. Common real causes: a database connectivity issue (same root cause as a `database_unavailable` alert — see `INCIDENT_RESPONSE_RUNBOOK.md`), or a real code defect in a job handler that throws outside the handler's own try/catch (a job handler's own errors are caught and recorded as a `FAILED` job — an uncaught throw escaping that boundary is a real bug to fix, not a operational issue to work around).
3. If a specific job is causing the crash loop (visible in the logs as the same `jobKey`/`jobId` failing repeatedly right before each crash), you can manually mark that one `Job` row `FAILED` (`UPDATE jobs SET status = 'FAILED', "completedAt" = now() WHERE id = '<id>';`) to unblock the queue while the underlying handler bug is fixed — this is a deliberate, manual escape hatch, not a background/automatic recovery, and should be logged in the incident's postmortem.

## Dead-letter and stuck-job hygiene

`GET /admin/alerts`'s `dead_letter_growth`/`stuck_job` checks (Phase 33) are the ongoing, automated version of this — real accumulated `FAILED` jobs or a job stuck `PENDING` well past its due time are both directly visible there, not something you need to remember to check manually.
