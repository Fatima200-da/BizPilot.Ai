import { prisma } from '../../infrastructure/database/prisma';
import { getCurrentSubscription } from './subscription.service';
import { getBalance } from './credit-ledger.service';
import { createNotification } from '../notifications/notification.service';

/**
 * Phase 26 Section 9: configurable usage-threshold alerts. "No duplicate
 * notifications for the same threshold/period" is enforced the same way
 * every other idempotent event in this phase is — a real Postgres unique
 * constraint on `Notification(workspaceId, type, relatedEntityId)`, where
 * `relatedEntityId` encodes `${currentPeriodStart}:${threshold}` so a new
 * billing period naturally gets its own fresh set of alerts without any
 * explicit reset logic.
 */
const THRESHOLDS = [80, 90, 100] as const;

export interface UsageAlertResult {
  usedPercent: number;
  triggered: string[];
}

export async function checkAndTriggerUsageAlerts(workspaceId: string): Promise<UsageAlertResult> {
  const [subscription, balance, workspace] = await Promise.all([
    getCurrentSubscription(workspaceId),
    getBalance(workspaceId),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
  ]);

  const allowance = subscription.plan.aiCreditsPerMonth;
  if (allowance <= 0) return { usedPercent: 0, triggered: [] };

  const usedPercent = Math.round(((allowance - balance) / allowance) * 100);
  const triggered: string[] = [];

  for (const threshold of THRESHOLDS) {
    if (usedPercent < threshold) continue;

    const type = threshold >= 100 ? 'CREDITS_EXHAUSTED' : 'CREDITS_LOW';
    const relatedEntityId = `${subscription.currentPeriodStart.toISOString()}:${String(threshold)}`;


    const { created } = await createNotification({
      workspaceId,
      recipientUserId: workspace.ownerUserId,
      category: 'BILLING',
      type,
      title: threshold >= 100 ? 'AI credits exhausted for this billing period' : `AI credit usage has reached ${String(threshold)}%`,
      body: `${String(usedPercent)}% of this period's ${String(allowance)}-credit allowance has been used.`,
      relatedEntityType: 'UsageAlert',
      relatedEntityId,
    });

    if (created) {
      triggered.push(`${type}:${String(threshold)}`);

      await prisma.auditLog.create({
        data: {
          workspaceId,
          actorUserId: null,
          action: 'BILLING_CHANGE',
          entityType: 'UsageAlert',
          entityId: relatedEntityId,
          newValue: { threshold, usedPercent, type },
        },
      });
    }
  }

  return { usedPercent, triggered };
}
