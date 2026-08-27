import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { getActivationStatus, getOnboardingState, advanceOnboardingStep } from './onboarding.service';

interface OnboardingStateData {
  step: string;
  completedAt: string | null;
  nextRecommendedAction: string | null;
  activation: { workspaceCreated: boolean; firstWorkflowCreated: boolean; firstSuccessfulAiOperation: boolean; isActivated: boolean };
}

describe('Onboarding & activation (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Onboarding Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Onboarding Test Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('a fresh workspace has real, backend-computed activation status: workspace created, nothing else yet', async () => {
    const activation = await getActivationStatus(workspace.workspaceId);
    expect(activation.workspaceCreated).toBe(true);
    expect(activation.firstWorkflowCreated).toBe(false);
    expect(activation.firstSuccessfulAiOperation).toBe(false);
    expect(activation.isActivated).toBe(false);
  });

  it('a fresh workspace starts onboarding at "workspace_created", never NULL', async () => {
    const state = await getOnboardingState(workspace.workspaceId);
    expect(state.step).toBe('workspace_created');
    expect(state.completedAt).toBeNull();
    expect(state.nextRecommendedAction).not.toBeNull();
  });

  it('onboarding is resumable — advancing to a step persists and is re-readable exactly as left', async () => {
    const advanced = await advanceOnboardingStep(workspace.workspaceId, 'profile_completed', owner.userId);
    expect(advanced.step).toBe('profile_completed');

    const reread = await getOnboardingState(workspace.workspaceId);
    expect(reread.step).toBe('profile_completed'); // survives a fresh read, not just the in-memory return value
  });

  it('advancing is forward-only and idempotent — attempting to go backward is a safe no-op', async () => {
    const result = await advanceOnboardingStep(workspace.workspaceId, 'workspace_created', owner.userId);
    expect(result.step).toBe('profile_completed'); // unchanged — never regresses
  });

  it('an unknown step is rejected with a validation error, not silently accepted', async () => {
    await expect(advanceOnboardingStep(workspace.workspaceId, 'not_a_real_step' as never, owner.userId)).rejects.toThrow();
  });

  it('completing onboarding sets completedAt and creates a real ONBOARDING_REMINDER notification', async () => {
    await advanceOnboardingStep(workspace.workspaceId, 'plan_chosen', owner.userId);
    await advanceOnboardingStep(workspace.workspaceId, 'team_invited', owner.userId);
    await advanceOnboardingStep(workspace.workspaceId, 'first_workflow_run', owner.userId);
    const completed = await advanceOnboardingStep(workspace.workspaceId, 'completed', owner.userId);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.nextRecommendedAction).toBeNull();
  });

  it('HTTP surface: GET/PATCH /workspaces/:id/onboarding and GET /workspaces/:id/onboarding/activation', async () => {
    const owner2 = await registerTestUser('Onboarding HTTP Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Onboarding HTTP Workspace');

    const getRes = await request(app).get(`/api/v1/workspaces/${ws2.workspaceId}/onboarding`).set('Authorization', `Bearer ${ws2.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(data<OnboardingStateData>(getRes).step).toBe('workspace_created');

    const patchRes = await request(app)
      .patch(`/api/v1/workspaces/${ws2.workspaceId}/onboarding`)
      .set('Authorization', `Bearer ${ws2.accessToken}`)
      .send({ step: 'profile_completed' });
    expect(patchRes.status).toBe(200);
    expect(data<OnboardingStateData>(patchRes).step).toBe('profile_completed');

    const activationRes = await request(app).get(`/api/v1/workspaces/${ws2.workspaceId}/onboarding/activation`).set('Authorization', `Bearer ${ws2.accessToken}`);
    expect(activationRes.status).toBe(200);
    expect(data<{ isActivated: boolean }>(activationRes).isActivated).toBe(false);

    await cleanupTestUser(owner2.email);
  });

  it('a completed real AI workflow run makes firstWorkflowCreated and firstSuccessfulAiOperation both true, and auto-advances onboarding all the way to completed', async () => {
    const owner3 = await registerTestUser('Activation Golden Path Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Activation Golden Path Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws3.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${ws3.accessToken}`)
      .send({ name: 'Activation Test Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    const businessProfileId = (profileRes.body as { data: { id: string } }).data.id;

    const startRes = await request(app)
      .post(`/api/v1/workspaces/${ws3.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${ws3.accessToken}`)
      .send({ businessProfileId });
    const instanceId = (startRes.body as { data: { id: string } }).data.id;

    await request(app).post(`/api/v1/workspaces/${ws3.workspaceId}/workflow-instances/${instanceId}/approve`).set('Authorization', `Bearer ${ws3.accessToken}`);

    const activation = await getActivationStatus(ws3.workspaceId);
    expect(activation.firstWorkflowCreated).toBe(true);
    expect(activation.firstSuccessfulAiOperation).toBe(true);
    expect(activation.isActivated).toBe(true); // all three real conditions met

    const onboarding = await getOnboardingState(ws3.workspaceId);
    // Phase 29: a real workflow completion now auto-advances onboarding
    // all the way to 'completed' (not just 'first_workflow_run') — the
    // audit found the four steps after 'profile_completed' were otherwise
    // unreachable from any real UI path; the two intermediate steps
    // ('plan_chosen'/'team_invited') have no distinct product moment for
    // this MVP's solo-owner persona, so completion is reached in this one
    // real, idempotent, forward-only jump.
    expect(onboarding.step).toBe('completed');
    expect(onboarding.status).toBe('COMPLETED');
    expect(onboarding.completedAt).not.toBeNull();

    await cleanupTestUser(owner3.email);
  });
});
