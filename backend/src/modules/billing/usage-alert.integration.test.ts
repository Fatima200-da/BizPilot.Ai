import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { checkAndTriggerUsageAlerts } from './usage-alert.service';
import { grantCredits } from './credit-ledger.service';
import { getCurrentSubscription } from './subscription.service';

describe('Usage alert engine (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Usage Alert Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Usage Alert Test Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('no alert fires below the 80% threshold', async () => {
    // FREE plan grants 100 credits; drain to 75% used (balance 25).
    await grantCredits({ workspaceId: workspace.workspaceId, amount: -75, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to 75% used' });
    const result = await checkAndTriggerUsageAlerts(workspace.workspaceId);
    expect(result.usedPercent).toBe(75);
    expect(result.triggered).toHaveLength(0);
  });

  it('crossing 80% triggers exactly one CREDITS_LOW alert, with a real Notification and AuditLog row', async () => {
    await grantCredits({ workspaceId: workspace.workspaceId, amount: -10, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to 85% used' });
    const result = await checkAndTriggerUsageAlerts(workspace.workspaceId);
    expect(result.usedPercent).toBe(85);
    expect(result.triggered).toEqual(['CREDITS_LOW:80']);

    const notifications = await prisma.notification.findMany({ where: { workspaceId: workspace.workspaceId, type: 'CREDITS_LOW' } });
    expect(notifications).toHaveLength(1);

    const auditRows = await prisma.auditLog.findMany({ where: { workspaceId: workspace.workspaceId, entityType: 'UsageAlert' } });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('re-checking at the SAME percentage never creates a duplicate alert for the same threshold', async () => {
    const before = await prisma.notification.count({ where: { workspaceId: workspace.workspaceId, type: 'CREDITS_LOW' } });
    const result = await checkAndTriggerUsageAlerts(workspace.workspaceId);
    expect(result.triggered).toHaveLength(0); // already alerted for 80% this period
    const after = await prisma.notification.count({ where: { workspaceId: workspace.workspaceId, type: 'CREDITS_LOW' } });
    expect(after).toBe(before);
  });

  it('crossing 90% then 100% triggers each threshold exactly once, cumulatively', async () => {
    await grantCredits({ workspaceId: workspace.workspaceId, amount: -6, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to 91% used' });
    const at91 = await checkAndTriggerUsageAlerts(workspace.workspaceId);
    expect(at91.triggered).toEqual(['CREDITS_LOW:90']); // 80% already alerted, only 90% is new

    await grantCredits({ workspaceId: workspace.workspaceId, amount: -9, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to exactly 100% used' });
    const at100 = await checkAndTriggerUsageAlerts(workspace.workspaceId);
    expect(at100.triggered).toEqual(['CREDITS_EXHAUSTED:100']);

    const allAlertTypes = await prisma.notification.findMany({ where: { workspaceId: workspace.workspaceId, category: 'BILLING', type: { in: ['CREDITS_LOW', 'CREDITS_EXHAUSTED'] } } });
    expect(allAlertTypes).toHaveLength(3); // 80%, 90%, 100% — exactly one each
  });

  it('CONCURRENCY: simultaneous usage-alert checks at a newly-crossed threshold create exactly one notification', async () => {
    const owner2 = await registerTestUser('Usage Alert Concurrency Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Usage Alert Concurrency Workspace');
    await grantCredits({ workspaceId: ws2.workspaceId, amount: -85, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to 85% used' });

    const results = await Promise.all(Array.from({ length: 8 }, () => checkAndTriggerUsageAlerts(ws2.workspaceId)));
    const triggeredCount = results.filter((r) => r.triggered.includes('CREDITS_LOW:80')).length;
    expect(triggeredCount).toBe(1); // exactly one of the 8 concurrent checks actually created the alert

    const notifications = await prisma.notification.count({ where: { workspaceId: ws2.workspaceId, type: 'CREDITS_LOW' } });
    expect(notifications).toBe(1);
    const auditRows = await prisma.auditLog.count({ where: { workspaceId: ws2.workspaceId, entityType: 'UsageAlert' } });
    expect(auditRows).toBe(1); // the audit write is equally exactly-once, not one per concurrent caller

    await cleanupTestUser(owner2.email);
  });

  it('a new billing period resets alerting — the same threshold can fire again for the new period', async () => {
    const owner3 = await registerTestUser('Usage Alert New Period Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Usage Alert New Period Workspace');
    await grantCredits({ workspaceId: ws3.workspaceId, amount: -85, type: 'MANUAL_ADJUSTMENT', note: 'test: drain to 85% used' });
    const first = await checkAndTriggerUsageAlerts(ws3.workspaceId);
    expect(first.triggered).toEqual(['CREDITS_LOW:80']);

    // Roll the period forward (only the clock is faked) and top up credits
    // back to the new period's full allowance, mirroring a real renewal.
    const subscription = await getCurrentSubscription(ws3.workspaceId);
    const newStart = new Date();
    const newEnd = new Date(newStart);
    newEnd.setMonth(newEnd.getMonth() + 1);
    await prisma.subscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: newStart, currentPeriodEnd: newEnd } });
    await grantCredits({ workspaceId: ws3.workspaceId, amount: 85, type: 'PLAN_GRANT', note: 'test: new period allowance' });
    await grantCredits({ workspaceId: ws3.workspaceId, amount: -85, type: 'MANUAL_ADJUSTMENT', note: 'test: drain new period to 85% used' });

    const second = await checkAndTriggerUsageAlerts(ws3.workspaceId);
    expect(second.triggered).toEqual(['CREDITS_LOW:80']); // fires again — a genuinely new period, not a duplicate

    const notifications = await prisma.notification.count({ where: { workspaceId: ws3.workspaceId, type: 'CREDITS_LOW' } });
    expect(notifications).toBe(2); // one per period

    await cleanupTestUser(owner3.email);
  });
});
