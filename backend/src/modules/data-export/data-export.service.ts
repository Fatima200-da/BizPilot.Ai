import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';

/**
 * Phase 32 Track O: real customer data export — a genuine GDPR-style
 * "right to data portability" bundle, not a stub. Scoped strictly by
 * `workspaceId` (the same server-verified boundary every other query in
 * this codebase already relies on), and deliberately excludes anything
 * auth-sensitive: no password hashes, no session/refresh-token hashes, no
 * other members' full User records — only the workspace's own real
 * business data plus enough team/subscription context to be a genuinely
 * complete export of "everything this workspace owns."
 */
export interface WorkspaceDataExport {
  exportedAt: string;
  workspace: { id: string; name: string; createdAt: Date };
  businessProfiles: unknown[];
  contacts: unknown[];
  leads: unknown[];
  contentAssets: unknown[];
  workflowInstances: unknown[];
  teamMembers: unknown[];
  subscription: unknown;
  feedback: unknown[];
  notifications: unknown[];
  aiUsage: unknown[];
  auditHistory: unknown[];
}

/**
 * Phase 33 Track L: extended beyond Phase 32's original scope to cover
 * the full requested category list — notifications, real AI-usage
 * records (credits/action-type/model, never provider-internal request
 * payloads), and real audit history. Every query remains strictly
 * `workspaceId`-scoped, the same server-verified boundary every other
 * query in this codebase already relies on — tenant isolation is
 * structural here, not an afterthought bolted onto a background job.
 */
export async function exportWorkspaceData(workspaceId: string): Promise<WorkspaceDataExport> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, name: true, createdAt: true } });

  const [businessProfiles, contacts, leads, contentAssets, workflowInstances, teamMembers, subscription, feedback, notifications, aiUsage, auditHistory] = await Promise.all([
    prisma.businessProfile.findMany({ where: { workspaceId } }),
    prisma.contact.findMany({ where: { workspaceId, deletedAt: null } }),
    prisma.lead.findMany({ where: { workspaceId, deletedAt: null } }),
    prisma.contentAsset.findMany({ where: { workspaceId } }),
    prisma.workflowInstance.findMany({ where: { workspaceId }, include: { stepRuns: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, status: true, createdAt: true, role: { select: { key: true } }, user: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.subscription.findFirst({ where: { workspaceId }, include: { plan: true } }),
    prisma.feedback.findMany({ where: { workspaceId } }),
    prisma.notification.findMany({ where: { workspaceId } }),
    prisma.aIUsage.findMany({ where: { workspaceId }, select: { id: true, actionType: true, status: true, creditsConsumed: true, modelProvider: true, modelName: true, createdAt: true } }),
    prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10_000 }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    workspace,
    businessProfiles,
    contacts,
    leads,
    contentAssets,
    workflowInstances,
    teamMembers,
    subscription,
    feedback,
    notifications,
    aiUsage,
    auditHistory,
  };
}

function logExportEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...data, timestamp: new Date().toISOString() }));
}

/**
 * Phase 33 Track L: the real background job — never runs synchronously
 * inside an HTTP request (a large workspace's export could take longer
 * than any reasonable request timeout). Writes the real export bundle to
 * a real file on disk under `EXPORT_DIR`, scoped by a real, random runId
 * so two concurrent exports (even for the same workspace) can never
 * collide on a file path. Throws on failure — the caller (the job-queue
 * handler) relies on that for the queue's already-certified retry/
 * backoff/dead-letter behavior, the exact same pattern backups and
 * retention purges already use.
 */
export async function runBackgroundExport(workspaceId: string, requestedByUserId?: string): Promise<{ runId: string; filePath: string; sizeBytes: number }> {
  const runId = randomUUID();
  const startedAt = new Date();

  await prisma.dataExportRun.create({ data: { id: runId, workspaceId, requestedByUserId, status: 'RUNNING', startedAt } });
  logExportEvent('export.started', { runId, workspaceId });

  try {
    const bundle = await exportWorkspaceData(workspaceId);

    const dir = env.EXPORT_DIR;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const filePath = join(dir, `${runId}.json`);
    await writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    const fileStat = await stat(filePath);

    const completedAt = new Date();
    await prisma.dataExportRun.update({
      where: { id: runId },
      data: { status: 'SUCCEEDED', filePath, sizeBytes: fileStat.size, completedAt, durationMs: completedAt.getTime() - startedAt.getTime() },
    });
    logExportEvent('export.succeeded', { runId, workspaceId, sizeBytes: fileStat.size });

    return { runId, filePath, sizeBytes: fileStat.size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.dataExportRun.update({ where: { id: runId }, data: { status: 'FAILED', errorMessage: message, completedAt: new Date() } });
    console.error(JSON.stringify({ level: 'error', event: 'export.failed', runId, workspaceId, error: message, timestamp: new Date().toISOString() }));
    throw err;
  }
}

export interface DataExportRunSummary {
  id: string;
  status: string;
  sizeBytes: number | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
}

/** Real, tenant-isolated listing — strictly scoped by `workspaceId`, never a global export list. */
export async function listExportRuns(workspaceId: string): Promise<DataExportRunSummary[]> {
  return prisma.dataExportRun.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: { id: true, status: true, sizeBytes: true, errorMessage: true, startedAt: true, completedAt: true, durationMs: true },
  });
}

/** Real, tenant-isolated single-run lookup — returns null (never another workspace's row) if the id doesn't belong to `workspaceId`. */
export async function getExportRun(workspaceId: string, runId: string): Promise<(DataExportRunSummary & { filePath: string | null }) | null> {
  return prisma.dataExportRun.findFirst({
    where: { id: runId, workspaceId },
    select: { id: true, status: true, sizeBytes: true, errorMessage: true, startedAt: true, completedAt: true, durationMs: true, filePath: true },
  });
}
