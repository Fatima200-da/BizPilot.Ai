import { readFile } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { requireAuth } from '../../common/utils/require-auth';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { exportWorkspaceData, getExportRun, listExportRuns } from './data-export.service';
import { enqueueDataExport } from './data-export-job.service';

/**
 * Phase 32 Track O: exporting an entire workspace's data is a genuinely
 * sensitive action (the same class of sensitivity as a credit adjustment
 * or a member removal) — real audit-log entry, same pattern already
 * established across this codebase (invitation cancellation, credit
 * adjustments), so a later "who exported our data and when" question has
 * a real, persisted answer.
 */
export const exportWorkspaceDataHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const workspaceId = req.params.workspaceId as string;

  const bundle = await exportWorkspaceData(workspaceId);

  await prisma.auditLog.create({
    data: { workspaceId, actorUserId: auth.userId, action: 'DATA_EXPORT', entityType: 'Workspace', entityId: workspaceId },
  });

  res.setHeader('Content-Disposition', `attachment; filename="workspace-${workspaceId}-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(bundle);
});

/** Phase 33 Track L: the real background variant — enqueues a real Job and returns immediately (202), never blocks the HTTP connection on a potentially-large export. */
export const triggerBackgroundExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const workspaceId = req.params.workspaceId as string;

  await enqueueDataExport(workspaceId, auth.userId);

  await prisma.auditLog.create({
    data: { workspaceId, actorUserId: auth.userId, action: 'DATA_EXPORT', entityType: 'Workspace', entityId: workspaceId },
  });

  res.status(202).json({ data: { message: 'Export enqueued — poll GET /export to see it appear and complete.' } });
});

/** Real, tenant-isolated listing of this workspace's own export runs. */
export const listExportRunsHandler = asyncHandler(async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const runs = await listExportRuns(workspaceId);
  res.json({ data: runs });
});

/** Real, tenant-isolated single-run status — 404 (never another workspace's data) if the run doesn't belong here. */
export const getExportRunHandler = asyncHandler(async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const runId = req.params.runId as string;
  const run = await getExportRun(workspaceId, runId);
  if (!run) throw new NotFoundError('Export run not found.');
  res.json({ data: run });
});

/** Real, tenant-isolated file download — only a SUCCEEDED run belonging to this exact workspace may be downloaded. */
export const downloadExportRunHandler = asyncHandler(async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;
  const runId = req.params.runId as string;
  const run = await getExportRun(workspaceId, runId);
  if (!run) throw new NotFoundError('Export run not found.');
  if (run.status !== 'SUCCEEDED' || !run.filePath) {
    throw new ValidationError([{ field: 'runId', code: 'NOT_READY', message: `Export is not ready for download (status: ${run.status}).` }]);
  }
  const content = await readFile(run.filePath, 'utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workspace-${workspaceId}-export-${runId}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(content);
});
