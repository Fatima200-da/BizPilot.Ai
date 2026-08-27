import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import * as adminService from './admin.service';
import { getBackupObservability, runDatabaseBackup } from '../backup/backup.service';
import { countPurgeEligible, getPurgeObservability, runDataRetentionPurge } from '../data-retention/data-retention.service';
import { evaluateAlerts } from '../alerting/alerting.service';

export const dashboardMetricsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminService.getDashboardMetrics();
  sendData(res, metrics);
});

export const searchUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await adminService.searchUsers(query);
  sendData(res, results);
});

export const searchWorkspacesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await adminService.searchWorkspaces(query);
  sendData(res, results);
});

export const inspectWorkspaceHandler = asyncHandler(async (req: Request, res: Response) => {
  const inspection = await adminService.inspectWorkspace(req.params.id as string);
  sendData(res, inspection);
});

export const workspaceAuditLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await adminService.getWorkspaceAuditLog(req.params.id as string);
  sendData(res, rows);
});

export const adjustCreditsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { amount?: number; note?: string };
  if (typeof body.amount !== 'number' || !body.note) {
    throw new ValidationError([{ field: 'amount', code: 'REQUIRED', message: 'amount (number) and note (string) are required.' }]);
  }
  const result = await adminService.adjustWorkspaceCredits(req.params.id as string, auth.userId, body.amount, body.note);
  sendData(res, result);
});

export const listDeadLetterJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const jobs = await adminService.listDeadLetterJobs(limit);
  sendData(res, jobs);
});

export const retryDeadLetterJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const job = await adminService.retryDeadLetterJob(req.params.id as string, auth.userId);
  sendData(res, job);
});

export const cancelDeadLetterJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { reason?: string };
  if (!body.reason) {
    throw new ValidationError([{ field: 'reason', code: 'REQUIRED', message: 'reason is required.' }]);
  }
  const job = await adminService.cancelDeadLetterJob(req.params.id as string, auth.userId, body.reason);
  sendData(res, job);
});

/** Phase 31 Track D: real backup observability — every field computed from real BackupRun rows, never a static/fabricated status. */
export const backupObservabilityHandler = asyncHandler(async (_req: Request, res: Response) => {
  const observability = await getBackupObservability();
  sendData(res, observability);
});

/** Phase 31: an out-of-band manual backup trigger, gated the same as every other admin action — synchronous by design (the admin waits for the real result), reusing the exact same `runDatabaseBackup` path a scheduled run uses. */
export const triggerManualBackupHandler = asyncHandler(async (_req: Request, res: Response) => {
  const run = await runDatabaseBackup({ triggerType: 'MANUAL' });
  sendData(res, run);
});

/** Phase 33 Track C: real data-retention purge observability. */
export const retentionObservabilityHandler = asyncHandler(async (_req: Request, res: Response) => {
  const observability = await getPurgeObservability();
  sendData(res, observability);
});

/** Phase 33 Track C: a real, read-only "what would be purged right now" preview — never commits a delete, lets an operator sanity-check before triggering. */
export const retentionPreviewHandler = asyncHandler(async (_req: Request, res: Response) => {
  const preview = await countPurgeEligible();
  sendData(res, preview);
});

/** Phase 33 Track C: an out-of-band manual purge trigger, gated and synchronous, same pattern as the manual backup trigger. */
export const triggerManualPurgeHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await runDataRetentionPurge({ triggerType: 'MANUAL' });
  sendData(res, result);
});

/** Phase 33 Track F: real, live alert evaluation — every field computed from real current state, never a hardcoded example. */
export const alertsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const alerts = await evaluateAlerts();
  sendData(res, { alerts, evaluatedAt: new Date().toISOString() });
});
