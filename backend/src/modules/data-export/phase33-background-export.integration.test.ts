import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { DATA_EXPORT_JOB_KEY, registerDataExportJobHandler } from './data-export-job.service';
import { runWorkerTick } from '../scheduler/job-queue.service';

/**
 * Phase 33 Track L: the real background variant of customer data export
 * — a real Job, drained through the actual job-queue worker path,
 * producing a real file on disk and a real, pollable `DataExportRun` row.
 * Tenant isolation verified the same way every other resource in this
 * codebase is: workspace B's own valid token cannot see or download
 * workspace A's export runs.
 */
describe('Phase 33 Track L: background data export (integration)', () => {
  it('triggering a background export enqueues a real Job that, once drained, produces a real SUCCEEDED run with a real downloadable file', async () => {
    await ensureSeeded();
    registerDataExportJobHandler();

    const user = await registerTestUser('Background Export Owner');
    const ws = await createTestWorkspace(user.accessToken, 'Background Export Workspace');

    const triggerRes = await request(app).post(`/api/v1/workspaces/${ws.workspaceId}/export/background`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(triggerRes.status).toBe(202);

    const result = await runWorkerTick(DATA_EXPORT_JOB_KEY, 'test-worker-export', 60_000);
    expect(result.claimed).toBe(true);
    expect(result.outcome).toBe('SUCCEEDED');

    const listRes = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/export/runs`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(listRes.status).toBe(200);
    const runs = (listRes.body as { data: Array<{ id: string; status: string }> }).data;
    expect(runs.length).toBeGreaterThan(0);
    const succeeded = runs.find((r) => r.status === 'SUCCEEDED');
    if (!succeeded) throw new Error('expected a SUCCEEDED export run');

    const downloadRes = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/export/runs/${succeeded.id}/download`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(downloadRes.status).toBe(200);
    const body = JSON.parse(downloadRes.text) as { workspace: { id: string } };
    expect(body.workspace.id).toBe(ws.workspaceId);

    const runRow = await prisma.dataExportRun.findUniqueOrThrow({ where: { id: succeeded.id } });
    if (runRow.filePath) await rm(runRow.filePath, { force: true });
    await prisma.dataExportRun.deleteMany({ where: { workspaceId: ws.workspaceId } });
    await cleanupTestUser(user.email);
  }, 30_000);

  it('workspace B (own valid workspace + token) cannot list or download workspace A\'s export runs', async () => {
    registerDataExportJobHandler();
    const ownerA = await registerTestUser('Background Export IDOR Owner A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Background Export IDOR Workspace A');
    await request(app).post(`/api/v1/workspaces/${wsA.workspaceId}/export/background`).set('Authorization', `Bearer ${wsA.accessToken}`);
    await runWorkerTick(DATA_EXPORT_JOB_KEY, 'test-worker-export-idor', 60_000);
    const runA = await prisma.dataExportRun.findFirstOrThrow({ where: { workspaceId: wsA.workspaceId } });

    const ownerB = await registerTestUser('Background Export IDOR Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Background Export IDOR Workspace B');

    const listRes = await request(app).get(`/api/v1/workspaces/${wsB.workspaceId}/export/runs`).set('Authorization', `Bearer ${wsB.accessToken}`);
    const runsB = (listRes.body as { data: Array<{ id: string }> }).data;
    expect(runsB.find((r) => r.id === runA.id)).toBeUndefined(); // A's run never appears in B's own list

    const downloadRes = await request(app).get(`/api/v1/workspaces/${wsB.workspaceId}/export/runs/${runA.id}/download`).set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(downloadRes.status).toBe(404); // B cannot download A's export by guessing/knowing its real ID

    if (runA.filePath) await rm(runA.filePath, { force: true });
    await prisma.dataExportRun.deleteMany({ where: { workspaceId: wsA.workspaceId } });
    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  }, 30_000);
});
