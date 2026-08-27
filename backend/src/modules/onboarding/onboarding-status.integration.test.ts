import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser, data } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { advanceOnboardingStep, skipOnboarding, getUserOnboardingStatus, getOnboardingState } from './onboarding.service';
import { login } from '../auth/auth.service';

interface OnboardingStateData {
  step: string;
  status: string;
  completedAt: string | null;
}
interface UserOnboardingStatusData {
  status: string;
  workspaceId: string | null;
}

/**
 * Phase 27 Section 2/3: the coarse NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED
 * state machine, plus the full onboarding-security matrix the spec
 * mandates: cross-user visibility, workspace-id path tampering,
 * completion-status forgery, duplicate-completion idempotency, refresh and
 * logout/login persistence, and a deleted-workspace guard.
 */
describe('Onboarding status state machine & security (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('a user with zero workspaces is NOT_STARTED — the one real state getOnboardingState structurally cannot represent', async () => {
    const user = await registerTestUser('Onboarding NotStarted User');
    const status = await getUserOnboardingStatus(user.userId);
    expect(status.status).toBe('NOT_STARTED');
    expect(status.workspaceId).toBeNull();
    await cleanupTestUser(user.email);
  });

  it('creating a workspace moves user-level status to IN_PROGRESS, reflecting the real workspace', async () => {
    const user = await registerTestUser('Onboarding InProgress User');
    const ws = await createTestWorkspace(user.accessToken, 'Onboarding InProgress Workspace');
    const status = await getUserOnboardingStatus(user.userId);
    expect(status.status).toBe('IN_PROGRESS');
    expect(status.workspaceId).toBe(ws.workspaceId);
    await cleanupTestUser(user.email);
  });

  it('HTTP surface: GET /onboarding/status reflects real state with no workspaceId path param needed', async () => {
    const user = await registerTestUser('Onboarding Status HTTP User');
    const notStartedRes = await request(app).get('/api/v1/onboarding/status').set('Authorization', `Bearer ${user.accessToken}`);
    expect(notStartedRes.status).toBe(200);
    expect(data<UserOnboardingStatusData>(notStartedRes).status).toBe('NOT_STARTED');

    await createTestWorkspace(user.accessToken, 'Onboarding Status HTTP Workspace');
    const inProgressRes = await request(app).get('/api/v1/onboarding/status').set('Authorization', `Bearer ${user.accessToken}`);
    expect(data<UserOnboardingStatusData>(inProgressRes).status).toBe('IN_PROGRESS');

    await cleanupTestUser(user.email);
  });

  it('skip: IN_PROGRESS -> SKIPPED, idempotent on repeat, rejected once already COMPLETED', async () => {
    const owner = await registerTestUser('Onboarding Skip Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Skip Workspace');

    const skipped = await skipOnboarding(ws.workspaceId, owner.userId);
    expect(skipped.status).toBe('SKIPPED');

    const skippedAgain = await skipOnboarding(ws.workspaceId, owner.userId); // idempotent, not an error
    expect(skippedAgain.status).toBe('SKIPPED');

    // Resume after skip: still allowed to reach COMPLETED (skip doesn't lock the user out).
    for (const step of ['profile_completed', 'plan_chosen', 'team_invited', 'first_workflow_run', 'completed'] as const) {
      // sequential step progression is the point
      await advanceOnboardingStep(ws.workspaceId, step, owner.userId);
    }
    const completed = await getOnboardingState(ws.workspaceId);
    expect(completed.status).toBe('COMPLETED');

    // The one genuinely invalid transition: skipping something already completed.
    await expect(skipOnboarding(ws.workspaceId, owner.userId)).rejects.toThrow();

    await cleanupTestUser(owner.email);
  });

  it('HTTP surface: PATCH /workspaces/:id/onboarding/skip', async () => {
    const owner = await registerTestUser('Onboarding Skip HTTP Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Skip HTTP Workspace');

    const res = await request(app).patch(`/api/v1/workspaces/${ws.workspaceId}/onboarding/skip`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(200);
    expect(data<OnboardingStateData>(res).status).toBe('SKIPPED');

    await cleanupTestUser(owner.email);
  });

  it('completion status cannot be forged by the client — only reaching the real "completed" step sets status COMPLETED', async () => {
    const owner = await registerTestUser('Onboarding Forge Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Forge Workspace');

    // The client sends an extra "status" field alongside a legitimate,
    // early step — the server only ever reads `step` from the body
    // (onboarding.controller.ts's advanceOnboardingHandler), so this can
    // never smuggle a COMPLETED status through.
    const res = await request(app)
      .patch(`/api/v1/workspaces/${ws.workspaceId}/onboarding`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ step: 'profile_completed', status: 'COMPLETED', onboardingStatus: 'COMPLETED' });

    expect(res.status).toBe(200);
    expect(data<OnboardingStateData>(res).step).toBe('profile_completed');
    expect(data<OnboardingStateData>(res).status).toBe('IN_PROGRESS'); // never forged to COMPLETED

    await cleanupTestUser(owner.email);
  });

  it('duplicate completion is idempotent — completing twice creates exactly one ONBOARDING_REMINDER notification, not two', async () => {
    const owner = await registerTestUser('Onboarding Duplicate Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Duplicate Workspace');

    for (const step of ['profile_completed', 'plan_chosen', 'team_invited', 'first_workflow_run', 'completed'] as const) {
      // sequential step progression is the point
      await advanceOnboardingStep(ws.workspaceId, step, owner.userId);
    }
    const firstCompletedAt = (await getOnboardingState(ws.workspaceId)).completedAt;

    // A second "completed" call — forward-only guard makes this a no-op read, not a re-completion.
    await advanceOnboardingStep(ws.workspaceId, 'completed', owner.userId);
    const secondCompletedAt = (await getOnboardingState(ws.workspaceId)).completedAt;
    expect(secondCompletedAt?.getTime()).toBe(firstCompletedAt?.getTime()); // completedAt never overwritten

    const reminderCount = await prisma.notification.count({ where: { workspaceId: ws.workspaceId, type: 'ONBOARDING_REMINDER' } });
    expect(reminderCount).toBe(1); // exactly one, not two

    await cleanupTestUser(owner.email);
  });

  it('state survives a simulated "refresh" (repeated independent reads) and a real logout/login cycle (fresh tokens, same durable state)', async () => {
    const owner = await registerTestUser('Onboarding Persistence Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Persistence Workspace');
    await advanceOnboardingStep(ws.workspaceId, 'profile_completed', owner.userId);

    const readA = await getOnboardingState(ws.workspaceId);
    const readB = await getOnboardingState(ws.workspaceId);
    expect(readA.step).toBe('profile_completed');
    expect(readB.step).toBe('profile_completed'); // refresh: independent reads agree

    // A real logout/login cycle: issue a brand-new token pair via the real
    // login path (not a cached/reused token) and confirm the state read
    // through those NEW credentials is identical — proving persistence is
    // in the database, not session-local.
    const freshLogin = await login({ email: owner.email, password: 'password1234' }, {});
    const stateWithFreshToken = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/onboarding`).set('Authorization', `Bearer ${freshLogin.accessToken}`);
    expect(stateWithFreshToken.status).toBe(200);
    expect(data<OnboardingStateData>(stateWithFreshToken).step).toBe('profile_completed');

    await cleanupTestUser(owner.email);
  });

  it('a workspace ID tampered into the path to target a workspace the caller has no membership in is 404, never a write', async () => {
    const ownerA = await registerTestUser('Onboarding Tamper Owner A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Onboarding Tamper Workspace A');
    const ownerB = await registerTestUser('Onboarding Tamper Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Onboarding Tamper Workspace B');

    // ownerB's real, workspace-scoped token (for wsB), but the PATH targets
    // ownerA's real, different workspace.
    const res = await request(app)
      .patch(`/api/v1/workspaces/${wsA.workspaceId}/onboarding/skip`)
      .set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(res.status).toBe(404); // enforceWorkspacePathMatch — not a leaked "this exists but isn't yours" 403

    const stillInProgress = await getOnboardingState(wsA.workspaceId);
    expect(stillInProgress.status).toBe('IN_PROGRESS'); // no write happened

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('a soft-deleted workspace no longer serves onboarding — 404, not stale state', async () => {
    const owner = await registerTestUser('Onboarding Deleted Workspace Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Onboarding Deleted Workspace');

    // This codebase has no workspace-deletion endpoint yet — the real,
    // direct-SQL equivalent of "the workspace has been deleted" is setting
    // the same `deletedAt` column every read-path already filters on
    // (workspace.service.ts, onboarding.service.ts's getActivationStatus).
    await prisma.workspace.update({ where: { id: ws.workspaceId }, data: { deletedAt: new Date() } });

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/onboarding/activation`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(404);

    await cleanupTestUser(owner.email);
  });
});
