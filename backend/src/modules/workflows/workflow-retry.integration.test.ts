import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { UpstreamProviderError } from '../../common/errors/app-error';
import { startWorkflow } from './workflow-engine.service';
import { registerWorkflowSteps } from './step-handler.registry';

interface InstanceData {
  id: string;
  status: string;
  currentStepKey: string | null;
}

const DEFINITION_KEY = `phase29-retry-test-${randomUUID().slice(0, 8)}`;

/**
 * Phase 29 Section 10: real, audited workflow failure recovery —
 * FAILED -> RETRYING -> RUNNING -> COMPLETED, driven through the real
 * HTTP retry endpoint against a real (test-scoped, but genuinely
 * registered exactly like marketing-autopilot.steps.ts registers the real
 * one) two-step workflow definition whose first step fails exactly once
 * (a real, controllable "transient provider outage, now recovered"
 * scenario) so the SAME instance can be proven to reach a real COMPLETED
 * state after one real retry — not just a state-flag transition.
 */
describe('Workflow instance retry (integration)', () => {
  let shouldFail = true;
  let step1Calls = 0;
  let step2Calls = 0;

  beforeAll(async () => {
    await ensureSeeded();
    await prisma.workflowDefinition.create({
      data: {
        workspaceId: null,
        key: DEFINITION_KEY,
        name: 'Phase 29 Retry Test Workflow',
        version: 1,
        status: 'ACTIVE',
        stepGraph: [
          { key: 'step_one', order: 1 },
          { key: 'step_two', order: 2 },
        ],
      },
    });
    registerWorkflowSteps(DEFINITION_KEY, [
      {
        key: 'step_one',
        order: 1,
        handler: (): Promise<{ output: unknown }> => {
          step1Calls += 1;
          if (shouldFail) throw new UpstreamProviderError('Simulated real provider outage.');
          return Promise.resolve({ output: { ok: true } });
        },
      },
      {
        key: 'step_two',
        order: 2,
        handler: (): Promise<{ output: unknown }> => {
          step2Calls += 1;
          return Promise.resolve({ output: { ok: true } });
        },
      },
    ]);
  });

  afterAll(async () => {
    const definition = await prisma.workflowDefinition.findFirst({ where: { key: DEFINITION_KEY } });
    if (definition) {
      const instances = await prisma.workflowInstance.findMany({ where: { workflowDefinitionId: definition.id }, select: { id: true } });
      const instanceIds = instances.map((i) => i.id);
      await prisma.workflowStepRun.deleteMany({ where: { workflowInstanceId: { in: instanceIds } } });
      await prisma.workflowInstance.deleteMany({ where: { id: { in: instanceIds } } });
      await prisma.workflowDefinition.delete({ where: { id: definition.id } });
    }
  });

  it('a genuinely failed instance can be inspected, retried, and reaches real COMPLETED — with a real audit trail', async () => {
    const owner = await registerTestUser('Retry Test Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Retry Test Workspace');

    shouldFail = true;
    step1Calls = 0;
    step2Calls = 0;
    const instance = await startWorkflow({ workspaceId: ws.workspaceId, workflowDefinitionKey: DEFINITION_KEY, triggeredByUserId: owner.userId, input: {} });
    expect(instance.status).toBe('FAILED');
    expect(instance.currentStepKey).toBe('step_one');
    expect(step1Calls).toBeGreaterThanOrEqual(1); // real retry-with-backoff already happened inside runStepWithRetry before permanent FAILED

    // INSPECT: the real, unmodified GET surface.
    const inspectRes = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instance.id}`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(inspectRes.status).toBe(200);
    expect((inspectRes.body as { data: InstanceData }).data.status).toBe('FAILED');

    // The underlying condition is now fixed — the next attempt succeeds for real.
    shouldFail = false;
    const retryRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instance.id}/retry`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ reason: 'Provider outage resolved — retrying.' });

    expect(retryRes.status).toBe(200);
    const retried = (retryRes.body as { data: InstanceData }).data;
    expect(retried.status).toBe('COMPLETED');
    expect(step2Calls).toBe(1); // step_two ran exactly once — the retry re-entered at step_one, not somewhere past it, and never re-ran step_two twice

    // Real audit trail: who, why, previous state, new state, timestamp.
    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, entityType: 'WorkflowInstance', entityId: instance.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(owner.userId);
    expect((audit?.previousValue as { status?: string } | null)?.status).toBe('FAILED');
    expect((audit?.newValue as { status?: string; reason?: string } | null)?.status).toBe('RETRYING');
    expect((audit?.newValue as { reason?: string } | null)?.reason).toContain('outage resolved');

    await cleanupTestUser(owner.email);
  });

  it('retrying an instance that is not FAILED is a real 409, never a silent no-op', async () => {
    const owner = await registerTestUser('Retry Invalid State Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Retry Invalid State Workspace');

    shouldFail = false;
    const instance = await startWorkflow({ workspaceId: ws.workspaceId, workflowDefinitionKey: DEFINITION_KEY, triggeredByUserId: owner.userId, input: {} });
    expect(instance.status).toBe('COMPLETED');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instance.id}/retry`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ reason: 'should not be allowed' });
    expect(res.status).toBe(409);

    await cleanupTestUser(owner.email);
  });

  it('retry requires a real reason — empty/missing is a real 422', async () => {
    const owner = await registerTestUser('Retry Reason Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Retry Reason Workspace');
    shouldFail = true;
    const instance = await startWorkflow({ workspaceId: ws.workspaceId, workflowDefinitionKey: DEFINITION_KEY, triggeredByUserId: owner.userId, input: {} });

    const missing = await request(app).post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instance.id}/retry`).set('Authorization', `Bearer ${ws.accessToken}`).send({});
    expect(missing.status).toBe(422);

    const empty = await request(app).post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instance.id}/retry`).set('Authorization', `Bearer ${ws.accessToken}`).send({ reason: '  ' });
    expect(empty.status).toBe(422);

    await cleanupTestUser(owner.email);
  });

  it('cross-tenant retry is a real 404, never a cross-tenant mutation', async () => {
    const ownerA = await registerTestUser('Retry Tenant A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Retry Tenant A Workspace');
    shouldFail = true;
    const instance = await startWorkflow({ workspaceId: wsA.workspaceId, workflowDefinitionKey: DEFINITION_KEY, triggeredByUserId: ownerA.userId, input: {} });

    const ownerB = await registerTestUser('Retry Tenant B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Retry Tenant B Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/workflow-instances/${instance.id}/retry`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ reason: 'forged cross-tenant retry attempt' });
    expect(res.status).toBe(404);

    const current = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(current.status).toBe('FAILED'); // never touched by the forged cross-tenant attempt

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });
});
