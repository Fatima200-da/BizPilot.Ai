import { registerJobHandler, enqueueJob } from '../scheduler/job-queue.service';
import { runBackgroundExport } from './data-export.service';

/**
 * Phase 33 Track L: wires the customer-data export to the same real,
 * already-certified job-queue machinery (Phase 27) backups and retention
 * purges already use — a background export inherits real retry/backoff
 * and dead-letter behavior for free, rather than reinventing it.
 */
export const DATA_EXPORT_JOB_KEY = 'workspace-data-export';

interface ExportJobPayload {
  workspaceId: string;
  requestedByUserId?: string;
}

export function registerDataExportJobHandler(): void {
  registerJobHandler(DATA_EXPORT_JOB_KEY, async (job) => {
    const payload = job.payload as ExportJobPayload | null;
    if (!payload?.workspaceId) throw new Error('Data-export job payload missing workspaceId.');
    await runBackgroundExport(payload.workspaceId, payload.requestedByUserId);
  });
}

/** Enqueues a real background export — a fresh, un-deduplicated Job every call (a real dedupeKey per request, since a user may legitimately request more than one export). */
export async function enqueueDataExport(workspaceId: string, requestedByUserId?: string): Promise<void> {
  await enqueueJob({
    jobKey: DATA_EXPORT_JOB_KEY,
    dedupeKey: `${workspaceId}:${String(Date.now())}:${Math.random().toString(36).slice(2)}`,
    payload: { workspaceId, requestedByUserId },
  });
}
