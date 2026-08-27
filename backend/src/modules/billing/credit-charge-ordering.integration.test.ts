import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStepWithRetry } from '../workflows/workflow-engine.service';
import { assertSufficientCredits, getBalance, recordUsage } from './credit-ledger.service';
import { UpstreamProviderError } from '../../common/errors/app-error';
import { InsufficientCreditsError } from '../../common/errors/app-error';
import { prisma } from '../../infrastructure/database/prisma';
import { registerTestUser, createTestWorkspace, cleanupTestUser, ensureSeeded } from '../../testing/integration-helpers';
import type { StepContext } from '../workflows/step-handler.registry';

/**
 * Phase 24 Section 12/6: regression test for a real defect found by this
 * phase's architecture audit (docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md Section
 * 6) — before the fix, an AI-bearing workflow step called `recordUsage`
 * (which deducts credits) BEFORE calling the provider, and
 * `runStepWithRetry` retries the entire step handler on a transient
 * `UpstreamProviderError`, so a transient-then-success sequence charged the
 * workspace once per attempt (2-3x) instead of once. The fix (Section 12)
 * is: check balance (no write) before the provider call, charge (write)
 * only after the provider call succeeds. This test drives that exact
 * pattern through the real retry engine and the real credit-ledger service
 * against a real database, without needing a live AI provider — the
 * provider call itself is simulated exactly the way
 * workflow-failure.integration.test.ts already simulates AI failures for
 * the same reason (MockProviderAdapter cannot fail by design).
 */
describe('Credit charge ordering under transient AI retry (integration)', () => {
  let workspaceId: string;
  let email: string;
  let instanceId: string;
  const cost = 5;

  beforeAll(async () => {
    await ensureSeeded();
    const user = await registerTestUser('Credit Ordering Test Owner');
    email = user.email;
    const workspace = await createTestWorkspace(user.accessToken, 'Credit Ordering Test Workspace');
    workspaceId = workspace.workspaceId;

    const definition = await prisma.workflowDefinition.findFirstOrThrow({ where: { workspaceId: null, key: 'marketing-autopilot' } });
    const instance = await prisma.workflowInstance.create({
      data: { workspaceId, workflowDefinitionId: definition.id, status: 'RUNNING', input: {} },
    });
    instanceId = instance.id;
  });

  afterAll(async () => {
    await cleanupTestUser(email);
  });

  function ctx(): StepContext {
    return { workspaceId, workflowInstanceId: instanceId, businessProfileId: null, triggeredByUserId: null, accumulated: {} };
  }

  /** Mirrors the FIXED marketing-autopilot.steps.ts pattern: check -> simulate provider call -> charge only on success. */
  function fixedPatternHandler(providerCall: () => void): () => Promise<{ output: { usageId: string; balanceAfter: number } }> {
    return async () => {
      await assertSufficientCredits(workspaceId, cost);
      providerCall(); // throws UpstreamProviderError to simulate a failed/transient provider call
      const { usageId, balanceAfter } = await recordUsage({ workspaceId, actionType: 'AUTOMATION_RUN', creditsConsumed: cost });
      return { output: { usageId, balanceAfter } };
    };
  }

  it('a transient provider failure that succeeds on retry is charged exactly once, not once per attempt', async () => {
    const balanceBefore = await getBalance(workspaceId);
    let calls = 0;

    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'charge_ordering_transient_then_succeeds',
        order: 200,
        handler: fixedPatternHandler(() => {
          calls += 1;
          if (calls < 3) throw new UpstreamProviderError('Simulated transient provider failure.');
        }),
      },
      ctx()
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(3); // failed twice, succeeded on the 3rd (== MAX_STEP_ATTEMPTS)

    const balanceAfter = await getBalance(workspaceId);
    expect(balanceBefore - balanceAfter).toBe(cost); // charged exactly once, not 3x

    const usageRows = await prisma.aIUsage.findMany({ where: { workspaceId, relatedEntityId: undefined, actionType: 'AUTOMATION_RUN' }, orderBy: { createdAt: 'desc' }, take: 5 });
    expect(usageRows.filter((r) => r.status === 'SUCCEEDED' && r.creditsConsumed === cost).length).toBeGreaterThanOrEqual(1);
  });

  it('a provider failure that exhausts all retries is never charged', async () => {
    const balanceBefore = await getBalance(workspaceId);
    let calls = 0;

    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'charge_ordering_always_fails',
        order: 201,
        handler: fixedPatternHandler(() => {
          calls += 1;
          throw new UpstreamProviderError('Simulated permanently-unavailable provider.');
        }),
      },
      ctx()
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(3); // MAX_STEP_ATTEMPTS, all failed

    const balanceAfter = await getBalance(workspaceId);
    expect(balanceAfter).toBe(balanceBefore); // never charged — the provider never returned a valid result
  });

  it('insufficient credits reject before the provider is ever called, and the balance is unchanged', async () => {
    const balanceBefore = await getBalance(workspaceId);
    let providerCalled = false;

    await expect(
      (async (): Promise<void> => {
        await assertSufficientCredits(workspaceId, balanceBefore + 1_000_000); // impossible to satisfy
        providerCalled = true; // must never reach here
      })()
    ).rejects.toThrow(InsufficientCreditsError);

    expect(providerCalled).toBe(false);
    const balanceAfter = await getBalance(workspaceId);
    expect(balanceAfter).toBe(balanceBefore);
  });
});
