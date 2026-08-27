import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../../common/middlewares/auth';
import { adminRateLimit } from '../../common/middlewares/rate-limit';
import {
  searchWorkspacesHandler,
  inspectWorkspaceHandler,
  workspaceAuditLogHandler,
  adjustCreditsHandler,
  dashboardMetricsHandler,
  searchUsersHandler,
  listDeadLetterJobsHandler,
  retryDeadLetterJobHandler,
  cancelDeadLetterJobHandler,
  backupObservabilityHandler,
  triggerManualBackupHandler,
  retentionObservabilityHandler,
  retentionPreviewHandler,
  triggerManualPurgeHandler,
  alertsHandler,
} from './admin.controller';
import { listAllFeedbackHandler, updateFeedbackStatusHandler } from '../feedback/feedback.controller';

/**
 * Mounted at top-level /admin (apiRouter). Every route here is gated by
 * `requireSystemAdmin` — server-authoritative, JWT-only (Section 7). Not
 * workspace-scoped by path convention (no `enforceWorkspacePathMatch`):
 * an admin's whole purpose is cross-workspace inspection, but the target
 * `:id` is still validated to exist (NotFoundError, not a silent no-op)
 * inside each service function.
 */
export const adminRouter = Router();
adminRouter.use(authenticate, requireSystemAdmin, adminRateLimit);
adminRouter.get('/dashboard', dashboardMetricsHandler);
adminRouter.get('/users', searchUsersHandler);
adminRouter.get('/workspaces', searchWorkspacesHandler);
adminRouter.get('/workspaces/:id', inspectWorkspaceHandler);
adminRouter.get('/workspaces/:id/audit-log', workspaceAuditLogHandler);
adminRouter.post('/workspaces/:id/credit-adjustment', adjustCreditsHandler);
adminRouter.get('/jobs/dead-letter', listDeadLetterJobsHandler);
adminRouter.post('/jobs/:id/retry', retryDeadLetterJobHandler);
adminRouter.post('/jobs/:id/cancel', cancelDeadLetterJobHandler);
adminRouter.get('/feedback', listAllFeedbackHandler);
adminRouter.patch('/feedback/:id/status', updateFeedbackStatusHandler);
adminRouter.get('/backups', backupObservabilityHandler);
adminRouter.post('/backups/trigger', triggerManualBackupHandler);
adminRouter.get('/retention', retentionObservabilityHandler);
adminRouter.get('/retention/preview', retentionPreviewHandler);
adminRouter.post('/retention/trigger', triggerManualPurgeHandler);
adminRouter.get('/alerts', alertsHandler);
