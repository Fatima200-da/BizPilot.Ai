import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { startTrial, convertTrial, expireTrialIfDue, isTrialEligible } from './trial.service';
import { getCurrentSubscription, grantMonthlyCreditsIfDue } from './subscription.service';
import { getBalance } from './credit-ledger.service';
import { ConflictError, InvalidStateTransitionError } from '../../common/errors/app-error';

describe('Trial engine & monthly credit allowance (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Trial Engine Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Trial Engine Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('Section 6: a fresh workspace is trial-eligible', async () => {
    expect(await isTrialEligible(workspace.workspaceId)).toBe(true);
  });

  it('Section 6: starting a trial moves FREE/ACTIVE -> targetPlan/TRIALING with a real trialEndsAt', async () => {
    const before = new Date();
    const updated = await startTrial(workspace.workspaceId, 'pro', owner.userId);
    expect(updated.status).toBe('TRIALING');
    expect(updated.trialEndsAt).not.toBeNull();
    expect((updated.trialEndsAt as Date).getTime()).toBeGreaterThan(before.getTime());

    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.plan.key).toBe('pro');
  });

  it('Section 6: a second trial attempt on the same account is rejected — server-side eligibility, not client-trusted', async () => {
    expect(await isTrialEligible(workspace.workspaceId)).toBe(false);
    // Even a brand-new workspace under the SAME owner account is ineligible.
    const secondWorkspace = await createTestWorkspace(owner.accessToken, 'Second Workspace Same Owner');
    expect(await isTrialEligible(secondWorkspace.workspaceId)).toBe(false);
    await expect(startTrial(secondWorkspace.workspaceId, 'pro', owner.userId)).rejects.toThrow(ConflictError);
  });

  it('Section 6: convertTrial moves TRIALING -> ACTIVE, retaining the trial plan (no real payment collected, correctly not claimed)', async () => {
    const converted = await convertTrial(workspace.workspaceId, owner.userId);
    expect(converted.status).toBe('ACTIVE');
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.plan.key).toBe('pro');
  });

  it('Section 6: convertTrial on a non-TRIALING subscription is rejected', async () => {
    await expect(convertTrial(workspace.workspaceId, owner.userId)).rejects.toThrow(InvalidStateTransitionError);
  });

  it('Section 6: expireTrialIfDue is a no-op for a trial that has not yet reached trialEndsAt', async () => {
    const owner2 = await registerTestUser('Trial Not Expired Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Trial Not Expired Workspace');
    await startTrial(ws2.workspaceId, 'starter', owner2.userId);
    const result = await expireTrialIfDue(ws2.workspaceId);
    expect(result).toBeNull();
    const subscription = await getCurrentSubscription(ws2.workspaceId);
    expect(subscription.status).toBe('TRIALING');
    await cleanupTestUser(owner2.email);
  });

  it('Section 6: an actually-past-due trial expires TRIALING -> EXPIRED and the workspace immediately falls back to a fresh ACTIVE FREE subscription — never left at subscription = NULL', async () => {
    const owner3 = await registerTestUser('Trial Expired Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Trial Expired Workspace');
    const trialSub = await startTrial(ws3.workspaceId, 'starter', owner3.userId);

    // Directly backdate trialEndsAt to simulate real elapsed time — the
    // expiry LOGIC itself is exercised for real; only the clock is faked,
    // which is the only honest way to test a 14-day boundary without
    // actually waiting 14 real days.
    await prisma.subscription.update({ where: { id: trialSub.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });

    const expiredResult = await expireTrialIfDue(ws3.workspaceId, owner3.userId);
    expect(expiredResult).not.toBeNull();
    const fresh = expiredResult as NonNullable<typeof expiredResult>;
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.id).not.toBe(trialSub.id); // a NEW subscription row, not the old TRIALING one mutated in place

    const oldRow = await prisma.subscription.findUniqueOrThrow({ where: { id: trialSub.id } });
    expect(oldRow.status).toBe('EXPIRED');

    const current = await getCurrentSubscription(ws3.workspaceId);
    expect(current.plan.key).toBe('free'); // fell back to FREE, not stuck on the expired paid plan
    expect(current.status).toBe('ACTIVE');

    await cleanupTestUser(owner3.email);
  });

  it('Section 8: grantMonthlyCreditsIfDue is idempotent per billing period — a fresh workspace\'s initial grant already counts as this period\'s grant', async () => {
    const owner4 = await registerTestUser('Monthly Grant Owner');
    const ws4 = await createTestWorkspace(owner4.accessToken, 'Monthly Grant Workspace');
    const balanceAfterCreation = await getBalance(ws4.workspaceId);

    const firstCall = await grantMonthlyCreditsIfDue(ws4.workspaceId);
    expect(firstCall.granted).toBe(false); // creation's own PLAN_GRANT already covers this period

    const secondCall = await grantMonthlyCreditsIfDue(ws4.workspaceId);
    expect(secondCall.granted).toBe(false);

    expect(await getBalance(ws4.workspaceId)).toBe(balanceAfterCreation); // unchanged — no double-grant

    await cleanupTestUser(owner4.email);
  });

  // Phase 25 Section 26: a second confirmed, deterministic PGlite-vs-real-Postgres
  // behavioral difference (see the identical gating comment in
  // team.integration.test.ts). This test compares a JS-generated
  // `new Date()` boundary against a DB-generated `now()` timestamp
  // (`AICredit.createdAt @default(now())`) via a `gte` filter —
  // subscription.service.ts's `grantMonthlyCreditsIfDue`. Verified
  // deterministic, not flaky: 3/3 runs against real Postgres pass; 3/3
  // runs against PGlite fail with the FIRST call already reporting
  // `granted: false`, meaning PGlite's `now()` does not reliably advance
  // relative to the Node process's `Date.now()` at the millisecond
  // resolution this boundary check needs (a known category of quirk in
  // embedded/WASM DB engines, not a real-Postgres-observed issue and not
  // an application logic defect — the logic is proven correct against the
  // real target database).
  const runsAgainstPglite = process.env.USE_PGLITE_ADAPTER === 'true';
  const itRealPostgresOnly = runsAgainstPglite ? it.skip : it;

  itRealPostgresOnly('Section 8: grantMonthlyCreditsIfDue grants a new allowance once the period has genuinely rolled over (real PostgreSQL only — see comment above)', async () => {
    const owner5 = await registerTestUser('Monthly Grant Rollover Owner');
    const ws5 = await createTestWorkspace(owner5.accessToken, 'Monthly Grant Rollover Workspace');
    const subscription = await getCurrentSubscription(ws5.workspaceId);
    const balanceBefore = await getBalance(ws5.workspaceId);

    // Simulate the period having rolled over: the new period starts now
    // (a fresh grant's real createdAt will fall within it) and ends a
    // month from now — not "starts next month", which would make even a
    // brand-new grant look like it predates the period.
    const newPeriodStart = new Date();
    const newPeriodEnd = new Date(newPeriodStart);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    await prisma.subscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: newPeriodStart, currentPeriodEnd: newPeriodEnd } });

    const result = await grantMonthlyCreditsIfDue(ws5.workspaceId);
    expect(result.granted).toBe(true);
    expect(result.amount).toBe(subscription.plan.aiCreditsPerMonth);
    expect(await getBalance(ws5.workspaceId)).toBe(balanceBefore + subscription.plan.aiCreditsPerMonth);

    // Calling again for the same (new) period does not grant a second time.
    const secondResult = await grantMonthlyCreditsIfDue(ws5.workspaceId);
    expect(secondResult.granted).toBe(false);

    await cleanupTestUser(owner5.email);
  });
});
