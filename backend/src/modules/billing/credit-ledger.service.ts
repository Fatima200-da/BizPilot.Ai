import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { InsufficientCreditsError } from '../../common/errors/app-error';
import { PRODUCT_EVENTS } from '../analytics/product-event.service';

/**
 * DATABASE.md Section 4's documented, binding formula (schema.prisma's own
 * doc comment on AICredit): balance is always
 * `sum(AICredit.amount) - sum(AIUsage.creditsConsumed)`. AICredit is a
 * SUPPLY-only ledger (grants/top-ups/refunds/adjustments/expiration);
 * consumption is recorded exclusively in AIUsage.creditsConsumed. This
 * service intentionally computes the true aggregate sum rather than trusting
 * `AICredit.balanceAfter` alone for reservation decisions — that field is
 * documented as a denormalized snapshot "reconciled by the source-of-truth
 * sum if drift is ever suspected," and at MVP data volume the aggregate
 * query is cheap enough to simply always be the source of truth.
 *
 * Phase 15 Section 22's concurrency requirement is satisfied by locking the
 * owning Workspace row for the duration of the reservation transaction —
 * AICredit/AIUsage have no parent ledger row of their own to lock.
 */

type TxClient = Prisma.TransactionClient | PrismaClient;

async function computeBalance(tx: TxClient, workspaceId: string): Promise<number> {
  const [creditSum, usageSum] = await Promise.all([
    tx.aICredit.aggregate({ where: { workspaceId }, _sum: { amount: true } }),
    tx.aIUsage.aggregate({ where: { workspaceId }, _sum: { creditsConsumed: true } }),
  ]);
  return (creditSum._sum.amount ?? 0) - (usageSum._sum.creditsConsumed ?? 0);
}

export async function getBalance(workspaceId: string): Promise<number> {
  return computeBalance(prisma, workspaceId);
}

/**
 * Phase 24 Section 12: a read-only pre-flight check, deliberately separate
 * from `recordUsage`. Callers that must not charge for an AI action until
 * the provider has actually returned a valid result (every AI-bearing
 * workflow step) call this BEFORE invoking the provider — so an
 * insufficient-credit workspace never reaches the provider at all — and
 * call `recordUsage` only after a successful, validated response. This
 * check does not lock the workspace row; a final authoritative check still
 * happens inside `recordUsage`'s own transaction at charge time, so a
 * concurrent spend between the two calls is caught there, not silently
 * allowed.
 */
export async function assertSufficientCredits(workspaceId: string, creditsRequired: number): Promise<void> {
  const currentBalance = await computeBalance(prisma, workspaceId);
  if (currentBalance < creditsRequired) {
    throw new InsufficientCreditsError(`Workspace has ${String(currentBalance)} AI credits; this action requires ${String(creditsRequired)}.`);
  }
}

/**
 * Reserves and immediately records consumption for one AI action, atomically
 * checked against the current balance. Returns the AIUsage row id so the
 * caller can attach observability fields (Section 9's persistence contract).
 *
 * Phase 24 Section 12: this must only be called AFTER the AI provider has
 * already returned a successful, validated result — never before. Calling
 * it before the provider call (the pre-Phase-24 pattern) causes a
 * transient-failure retry to charge the workspace once per attempt instead
 * of once per logical action, since the workflow engine retries the whole
 * step handler, not just the provider call.
 */
export async function recordUsage(params: {
  workspaceId: string;
  userId?: string;
  actionType: 'COPILOT_CHAT' | 'CONTENT_SHORT' | 'CONTENT_LONGFORM' | 'IMAGE_GENERATION' | 'CALL_SUMMARY' | 'AUTOMATION_RUN' | 'INSIGHTS_REPORT' | 'OTHER';
  creditsConsumed: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
  modelProvider?: string;
  modelName?: string;
  latencyMs?: number;
}): Promise<{ usageId: string; balanceAfter: number; status: 'SUCCEEDED' | 'BLOCKED_BY_CREDIT_LIMIT' }> {
  // Phase 27: the BLOCKED_BY_CREDIT_LIMIT row must be a real, persisted
  // observability record, not merely claimed in the thrown error's message.
  // It is created and committed INSIDE the locked transaction (so the
  // balance check and the row write are still atomic under concurrency),
  // but the transaction itself must SUCCEED regardless of outcome — if it
  // threw from inside the callback here, Prisma would roll back the entire
  // transaction, silently discarding the very row this function claims to
  // have logged. `InsufficientCreditsError` is thrown AFTER the transaction
  // has committed, from the result it returns.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${params.workspaceId}::uuid FOR UPDATE`;

    const currentBalance = await computeBalance(tx, params.workspaceId);
    const blocked = currentBalance < params.creditsConsumed;

    const usage = await tx.aIUsage.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        actionType: params.actionType,
        status: blocked ? 'BLOCKED_BY_CREDIT_LIMIT' : 'SUCCEEDED',
        creditsConsumed: blocked ? 0 : params.creditsConsumed,
        relatedEntityType: params.relatedEntityType,
        relatedEntityId: params.relatedEntityId,
        modelProvider: params.modelProvider,
        modelName: params.modelName,
        latencyMs: params.latencyMs,
      },
    });

    // Phase 30 Track H.15: a real, reproduced concurrency defect — this
    // gated "first successful AI operation" event used to be a
    // check-then-write done AFTER this transaction committed (and its row
    // lock released), which is a genuine TOCTOU race: 20 real concurrent
    // `recordUsage` calls for one brand-new workspace reproduced 2+
    // FIRST_AI_ACTION rows in 3/3 stress runs. Moving the check-and-write
    // inside this same transaction, guarded by the SAME workspace row
    // lock already held above, makes it exactly-once for real — every
    // concurrent caller serializes on that lock, so only the one that
    // observes zero prior FIRST_AI_ACTION rows can ever write one. The
    // insert itself is wrapped in try/catch (never allowed to abort the
    // real credit charge this transaction exists for — tracking must
    // never break business logic, the same invariant `trackEvent` itself
    // already upholds outside a transaction).
    if (!blocked) {
      try {
        const alreadyFired = await tx.productEvent.findFirst({ where: { workspaceId: params.workspaceId, eventName: PRODUCT_EVENTS.FIRST_AI_ACTION }, select: { id: true } });
        if (!alreadyFired) {
          await tx.productEvent.create({
            data: { workspaceId: params.workspaceId, userId: params.userId, eventName: PRODUCT_EVENTS.FIRST_AI_ACTION, entityType: 'AIUsage', entityId: usage.id, properties: { actionType: params.actionType } },
          });
        }
      } catch (err) {
        console.error('[credit-ledger] FIRST_AI_ACTION tracking failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    return { usageId: usage.id, blocked, currentBalance };
  });

  if (result.blocked) {
    throw new InsufficientCreditsError(
      `Workspace has ${String(result.currentBalance)} AI credits; this action requires ${String(params.creditsConsumed)}. (Usage attempt logged as ${result.usageId}.)`
    );
  }

  return { usageId: result.usageId, balanceAfter: result.currentBalance - params.creditsConsumed, status: 'SUCCEEDED' };
}

/** Grants an initial or top-up credit balance — writes to AICredit, the supply side of the ledger. */
export async function grantCredits(params: {
  workspaceId: string;
  amount: number;
  type?: 'PLAN_GRANT' | 'ROLLOVER' | 'TOPUP_PURCHASE' | 'PROMOTIONAL' | 'REFUND' | 'MANUAL_ADJUSTMENT';
  note: string;
  createdByUserId?: string;
}): Promise<{ balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${params.workspaceId}::uuid FOR UPDATE`;
    const currentBalance = await computeBalance(tx, params.workspaceId);
    const balanceAfter = currentBalance + params.amount;
    await tx.aICredit.create({
      data: {
        workspaceId: params.workspaceId,
        type: params.type ?? 'PLAN_GRANT',
        amount: params.amount,
        balanceAfter,
        note: params.note,
        createdByUserId: params.createdByUserId,
      },
    });
    return { balanceAfter };
  });
}
