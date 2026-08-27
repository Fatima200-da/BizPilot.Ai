import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { UpstreamProviderError, ValidationError } from '../../common/errors/app-error';
import { runStepWithRetry } from './workflow-engine.service';
import { registerTestUser, createTestWorkspace, cleanupTestUser, ensureSeeded } from '../../testing/integration-helpers';
import type { StepContext } from './step-handler.registry';

/**
 * Phase 18 Section 10: failure-resilience testing against a real database.
 * `runStepWithRetry` is the engine's actual retry/failure boundary — these
 * tests drive it directly with controlled failing handlers (an AI-provider
 * failure is, from the engine's point of view, exactly an UpstreamProviderError
 * thrown by a step handler) rather than trying to make the real mock AI
 * provider fail, which it cannot do by design (it is deterministic fixture
 * data, not a network call).
 */
describe('Workflow engine failure resilience (integration)', () => {
  let workspaceId: string;
  let email: string;
  let instanceId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const user = await registerTestUser('Failure Test Owner');
    email = user.email;
    const workspace = await createTestWorkspace(user.accessToken, 'Failure Test Workspace');
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

  it('a transient (AI/upstream provider) failure is retried up to the max, then reported as failed — never silently swallowed', async () => {
    let calls = 0;
    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'always_transient_fail',
        order: 99,
        handler: () => {
          calls += 1;
          throw new UpstreamProviderError('Simulated AI provider unavailable.');
        },
      },
      ctx()
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(3); // MAX_STEP_ATTEMPTS
    if (!result.ok) expect(result.error).toMatch(/Simulated AI provider unavailable/);

    const runs = await prisma.workflowStepRun.findMany({ where: { workflowInstanceId: instanceId, stepKey: 'always_transient_fail' }, orderBy: { attempt: 'asc' } });
    expect(runs).toHaveLength(3);
    expect(runs[0]?.status).toBe('RETRYING');
    expect(runs[1]?.status).toBe('RETRYING');
    expect(runs[2]?.status).toBe('FAILED'); // last attempt exhausted -> FAILED, not RETRYING forever
  });

  it('a transient failure that succeeds on retry recovers cleanly — no duplicate/orphaned step-run rows', async () => {
    let calls = 0;
    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'transient_then_succeeds',
        order: 100,
        handler: () => {
          calls += 1;
          if (calls < 2) throw new UpstreamProviderError('Simulated transient failure.');
          return Promise.resolve({ output: { ok: true } });
        },
      },
      ctx()
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);

    const runs = await prisma.workflowStepRun.findMany({ where: { workflowInstanceId: instanceId, stepKey: 'transient_then_succeeds' } });
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
    expect(runs.filter((r) => r.status === 'RETRYING')).toHaveLength(1);
  });

  it('a permanent (validation) failure is never retried — exactly one attempt, immediately FAILED', async () => {
    let calls = 0;
    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'permanent_validation_fail',
        order: 101,
        handler: () => {
          calls += 1;
          throw new ValidationError([{ field: 'topic', code: 'INVALID', message: 'Simulated permanently invalid AI output.' }]);
        },
      },
      ctx()
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(1); // Section 15: never blindly retry a permanent/validation failure

    const runs = await prisma.workflowStepRun.findMany({ where: { workflowInstanceId: instanceId, stepKey: 'permanent_validation_fail' } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('FAILED');
  });

  // Phase 24 Section 7: malformed AI provider output (JSON.parse throwing a
  // raw SyntaxError, exactly what marketing-autopilot.steps.ts's
  // `JSON.parse(result.outputJson)` does for a genuinely malformed
  // completion) must never crash the process and must not be retried
  // forever — it is classified as permanent (isTransientError only matches
  // UpstreamProviderError/AbortError/timeout-like messages), so it fails
  // fast on the first attempt, same as a validation error.
  it('malformed provider JSON (a raw SyntaxError from JSON.parse) is treated as a permanent failure — one attempt, FAILED, no crash', async () => {
    let calls = 0;
    const result = await runStepWithRetry(
      instanceId,
      {
        key: 'malformed_json_output',
        order: 102,
        handler: () => {
          calls += 1;
          JSON.parse('{ not valid json'); // throws SyntaxError, exactly like a malformed provider completion would
          return Promise.resolve({ output: {} });
        },
      },
      ctx()
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(1); // not retried — process is still alive and able to report this result

    const runs = await prisma.workflowStepRun.findMany({ where: { workflowInstanceId: instanceId, stepKey: 'malformed_json_output' } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('FAILED');
  });
});
