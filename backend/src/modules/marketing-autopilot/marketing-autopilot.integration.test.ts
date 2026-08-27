import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, errorBody, registerTestUser } from '../../testing/integration-helpers';

interface BusinessProfileData {
  id: string;
}
interface ContentAssetData {
  status: string;
}
interface StepRunData {
  status: string;
}
interface WorkflowInstanceData {
  id: string;
  status: string;
  contentAssets: ContentAssetData[];
  stepRuns: StepRunData[];
}

/**
 * Phase 16 Sections 9-11: the Marketing Autopilot workflow against a real
 * database — WorkflowInstance/WorkflowStepRun/ContentAsset persistence,
 * the AWAITING_APPROVAL gate, approval, idempotency, and unauthorized/
 * cross-workspace execution attempts. Requires a real, migrated
 * PostgreSQL instance with BOTH seeds applied (`npm run db:seed`) — the
 * RBAC roles this test's workspace-creation depends on, and the
 * `marketing-autopilot` WorkflowDefinition this test starts.
 */
describe('Marketing Autopilot workflow (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let businessProfileId: string;
  let otherWorkspaceOwner: Awaited<ReturnType<typeof registerTestUser>>;
  let otherWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Autopilot Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Autopilot Test Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Test Salon', industry: 'Gözəllik salonu', targetAudience: 'Test audience', contentLanguage: 'AZ' });
    businessProfileId = data<BusinessProfileData>(profileRes).id;

    otherWorkspaceOwner = await registerTestUser('Other Workspace Owner');
    otherWorkspace = await createTestWorkspace(otherWorkspaceOwner.accessToken, 'Other Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
    await cleanupTestUser(otherWorkspaceOwner.email);
  });

  it('Section 9: runs all 7 steps and persists WorkflowInstance + WorkflowStepRun + 30 ContentAsset rows', async () => {
    const startRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ businessProfileId, objective: 'bookings', platforms: ['instagram', 'whatsapp'] });

    expect(startRes.status).toBe(201);
    const started = data<WorkflowInstanceData>(startRes);
    expect(started.status).toBe('AWAITING_APPROVAL');

    // Section 12: "refreshing the browser" == re-fetching from the API, not trusting client state.
    const fetchRes = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${started.id}`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);

    expect(fetchRes.status).toBe(200);
    const fetched = data<WorkflowInstanceData>(fetchRes);
    expect(fetched.contentAssets).toHaveLength(30);
    // All 7 steps SUCCEED as individual step-runs — including await_approval
    // itself, whose handler succeeds and separately signals the *instance*
    // to pause at AWAITING_APPROVAL. A step's own run status and the
    // instance's overall status are deliberately independent (Section 8 of
    // the record doc): "workflow completed" != "content approved" applies
    // symmetrically to "step succeeded" != "instance still running".
    expect(fetched.stepRuns.filter((s) => s.status === 'SUCCEEDED')).toHaveLength(7);
    expect(fetched.contentAssets.every((a) => a.status === 'DRAFT')).toBe(true);

    const approveRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${started.id}/approve`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);

    expect(approveRes.status).toBe(200);
    const approved = data<WorkflowInstanceData>(approveRes);
    expect(approved.status).toBe('COMPLETED');
    // Phase 18 regression guard: the approve response itself (not a
    // follow-up refetch) must include contentAssets/stepRuns — the frontend
    // sets this response directly as its full instance state and renders
    // `instance.contentAssets.slice()` immediately, which previously crashed
    // the entire app on every real approval (see workflow-engine.service.ts).
    expect(approved.contentAssets).toHaveLength(30);
    expect(approved.stepRuns.length).toBeGreaterThan(0);
  });

  it('Section 11: a duplicate request with the same idempotencyKey reuses the existing instance, never creates a second one', async () => {
    const idempotencyKey = 'integration-test-fixed-key';

    const first = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ businessProfileId, objective: 'sales', platforms: ['instagram'], idempotencyKey });

    const second = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ businessProfileId, objective: 'sales', platforms: ['instagram'], idempotencyKey });

    expect(data<WorkflowInstanceData>(first).id).toBe(data<WorkflowInstanceData>(second).id);
  });

  it('Section 10 Case E: an unauthorized user (no token) cannot start a workflow', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .send({ businessProfileId, objective: 'bookings', platforms: ['instagram'] });
    expect(res.status).toBe(401);
  });

  it('Section 10 Case F: a cross-workspace execution attempt is a 404, not a 403 or a leak', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${otherWorkspace.accessToken}`)
      .send({ businessProfileId, objective: 'bookings', platforms: ['instagram'] });
    expect(res.status).toBe(404);
  });

  it('Section 10 Case A: a missing businessProfileId fails validation and never falsely completes', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ objective: 'bookings', platforms: ['instagram'] });
    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });

  /**
   * Phase 18 Section 11: the existing idempotency test above fires the two
   * requests sequentially, which only proves the check-then-create path.
   * This fires them truly concurrently (Promise.all) to exercise the actual
   * race-safety guarantee — the unique constraint on (workspaceId,
   * workflowDefinitionId, idempotencyKey) plus the P2002 catch in
   * workflow-engine.service.ts's startWorkflow — not just the common case.
   */
  it('Section 11 (concurrency): two truly concurrent requests with the same idempotencyKey still produce exactly one WorkflowInstance', async () => {
    const idempotencyKey = 'integration-test-concurrent-key';

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspace.accessToken}`)
        .send({ businessProfileId, objective: 'awareness', platforms: ['instagram'], idempotencyKey }),
      request(app)
        .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspace.accessToken}`)
        .send({ businessProfileId, objective: 'awareness', platforms: ['instagram'], idempotencyKey }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = data<WorkflowInstanceData>(first).id;
    const secondId = data<WorkflowInstanceData>(second).id;
    expect(firstId).toBe(secondId);

    const list = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${firstId}`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    // Exactly 30 ContentAsset rows, not 60 — proves the race didn't cause the
    // step pipeline to run twice for the same logical request.
    expect(data<WorkflowInstanceData>(list).contentAssets).toHaveLength(30);
  });

  it('Section 10 (repeated approval): approving an already-COMPLETED instance is rejected with 409, not silently re-processed', async () => {
    const startRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ businessProfileId, objective: 'sales', platforms: ['instagram'] });
    const instanceId = data<WorkflowInstanceData>(startRes).id;

    const firstApprove = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${instanceId}/approve`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(firstApprove.status).toBe(200);
    expect(data<WorkflowInstanceData>(firstApprove).status).toBe('COMPLETED');

    const secondApprove = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${instanceId}/approve`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(secondApprove.status).toBe(409);
    expect(errorBody(secondApprove).code).toBe('BUSINESS_INVALID_STATE_TRANSITION');

    // State after the rejected repeat must be unchanged, not corrupted.
    const verify = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${instanceId}`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(data<WorkflowInstanceData>(verify).status).toBe('COMPLETED');
    expect(data<WorkflowInstanceData>(verify).contentAssets).toHaveLength(30);
  });

  /**
   * Phase 19: "resume my existing plan" — closes the gap documented in
   * docs/FIRST_CUSTOMER_READINESS.md where navigating back to Marketing
   * Autopilot after generating a plan showed the "start new" form again
   * instead of the already-generated calendar.
   */
  it('GET /workflow-instances/latest returns null for a brand-new workspace with no instances yet', async () => {
    const freshOwner = await registerTestUser('Latest Test Fresh Owner');
    const freshWorkspace = await createTestWorkspace(freshOwner.accessToken, 'Fresh Workspace No Instances');

    const res = await request(app)
      .get(`/api/v1/workspaces/${freshWorkspace.workspaceId}/workflow-instances/latest`)
      .query({ workflowDefinitionKey: 'marketing-autopilot' })
      .set('Authorization', `Bearer ${freshWorkspace.accessToken}`);

    expect(res.status).toBe(200);
    expect(data<WorkflowInstanceData | null>(res)).toBeNull();

    await cleanupTestUser(freshOwner.email);
  });

  it('GET /workflow-instances/latest returns the most recently created instance, with full relations', async () => {
    // A fresh workspace, not the file's shared `workspace` fixture: by this
    // point in the file, `workspace` has already spent its free-tier AI
    // credit allowance on earlier tests' workflow runs (each run costs real
    // credits — correct, intentional billing enforcement, not a bug). Using
    // a fresh workspace gives this test its own full starter allowance.
    const latestTestOwner = await registerTestUser('Latest Test Owner');
    const latestTestWorkspace = await createTestWorkspace(latestTestOwner.accessToken, 'Latest Test Workspace');
    const latestProfileRes = await request(app)
      .post(`/api/v1/workspaces/${latestTestWorkspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${latestTestWorkspace.accessToken}`)
      .send({ name: 'Latest Test Biz', industry: 'Gözəllik salonu', targetAudience: 'Test audience', contentLanguage: 'AZ' });
    const latestProfileId = data<BusinessProfileData>(latestProfileRes).id;

    const first = await request(app)
      .post(`/api/v1/workspaces/${latestTestWorkspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${latestTestWorkspace.accessToken}`)
      .send({ businessProfileId: latestProfileId, objective: 'awareness', platforms: ['instagram'] });
    const firstId = data<WorkflowInstanceData>(first).id;

    await new Promise((resolve) => setTimeout(resolve, 5)); // ensure a distinct createdAt ordering

    const second = await request(app)
      .post(`/api/v1/workspaces/${latestTestWorkspace.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${latestTestWorkspace.accessToken}`)
      .send({ businessProfileId: latestProfileId, objective: 'sales', platforms: ['instagram'] });
    const secondId = data<WorkflowInstanceData>(second).id;
    expect(secondId).not.toBe(firstId);
    expect(data<WorkflowInstanceData>(second).status).toBe('AWAITING_APPROVAL');

    const latest = await request(app)
      .get(`/api/v1/workspaces/${latestTestWorkspace.workspaceId}/workflow-instances/latest`)
      .query({ workflowDefinitionKey: 'marketing-autopilot' })
      .set('Authorization', `Bearer ${latestTestWorkspace.accessToken}`);

    expect(latest.status).toBe(200);
    const latestData = data<WorkflowInstanceData>(latest);
    expect(latestData.id).toBe(secondId);
    expect(latestData.contentAssets).toHaveLength(30);

    await cleanupTestUser(latestTestOwner.email);
  });

  it('GET /workflow-instances/latest is rejected 404 when the workspace path is forged (tenant isolation)', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/latest`)
      .query({ workflowDefinitionKey: 'marketing-autopilot' })
      .set('Authorization', `Bearer ${otherWorkspace.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('GET /workflow-instances/latest requires the workflowDefinitionKey query param', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/latest`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(res.status).toBe(422);
  });

  /**
   * Phase 20 Section 8.2: real concurrency test for the approval race Phase
   * 19 found by code review but did not reproduce or fix. Two genuinely
   * concurrent (`Promise.all`, not sequential) approval requests against
   * the SAME AWAITING_APPROVAL instance must result in exactly one
   * successful transition and exactly one 409 — never two successes, never
   * a double-run of the remaining workflow steps.
   */
  it('Section 8.2 (concurrency): two truly concurrent approval requests produce exactly one success and one 409', async () => {
    const owner = await registerTestUser('Concurrent Approval Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Concurrent Approval Workspace');
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ name: 'Concurrent Approval Biz', industry: 'Test', contentLanguage: 'AZ' });
    const businessProfileId = data<BusinessProfileData>(profileRes).id;

    const startRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ businessProfileId, objective: 'bookings', platforms: ['instagram'] });
    const instanceId = data<WorkflowInstanceData>(startRes).id;

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instanceId}/approve`)
        .set('Authorization', `Bearer ${ws.accessToken}`),
      request(app)
        .post(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instanceId}/approve`)
        .set('Authorization', `Bearer ${ws.accessToken}`),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]); // exactly one winner, exactly one loser — never [200, 200]

    const winner = first.status === 200 ? first : second;
    expect(data<WorkflowInstanceData>(winner).status).toBe('COMPLETED');

    // The workflow's remaining steps must not have double-run: still
    // exactly 30 content assets (the upsert fix, Section 8.1, would mask a
    // double-run of persist_assets as "still 30 rows" — step-run count is
    // the more sensitive signal that would catch a genuine double-execution).
    const finalFetch = await request(app)
      .get(`/api/v1/workspaces/${ws.workspaceId}/workflow-instances/${instanceId}`)
      .set('Authorization', `Bearer ${ws.accessToken}`);
    const final = data<WorkflowInstanceData>(finalFetch);
    expect(final.contentAssets).toHaveLength(30);
    expect(final.stepRuns.filter((s) => s.status === 'SUCCEEDED')).toHaveLength(7); // not 8 — await_approval's step-run never re-ran a second time

    await cleanupTestUser(owner.email);
  });
});
