import { Prisma, type WorkflowInstance, type WorkflowInstanceStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { InvalidStateTransitionError, NotFoundError, UpstreamProviderError } from '../../common/errors/app-error';
import { recordWorkflowExecution, recordWorkflowRetry } from '../../common/observability/metrics';
import { getWorkflowSteps } from './step-handler.registry';
import type { StepContext } from './step-handler.registry';
import { createNotification } from '../notifications/notification.service';
import { advanceOnboardingStep } from '../onboarding/onboarding.service';
import { trackEvent, hasWorkspaceEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

/**
 * Resolves AI_PLATFORM_ARCHITECTURE.md Section 10.1's Workflow Engine
 * behavior against the persistence schema added in
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 38.2. Executes steps
 * in-process, sequentially, within the triggering HTTP request — a
 * deliberate MVP simplification of that document's Job/Queue-dispatched
 * design (BACKEND_ARCHITECTURE.md Section 8 describes but the repository
 * does not yet implement a queue; introducing one now would be exactly the
 * "unnecessary abstraction" Phase 15 Section 45 warns against, since the
 * mock/real AI calls this MVP makes complete in well under a second each).
 * The step/state-machine SHAPE is unchanged, so a future migration to
 * queue-dispatched steps changes only how a step is invoked, not this
 * engine's contract.
 */

/**
 * Phase 20 found, and Phase 22 Section 26 formally decides: three of the
 * transitions below are declared but not currently reachable by any live
 * code path — RETRYING at the INSTANCE level (step-level retries use the
 * separate WorkflowStepStatus.RETRYING on WorkflowStepRun, exhausted
 * internally by runStepWithRetry's MAX_STEP_ATTEMPTS loop before the
 * instance itself is ever marked FAILED — the instance never sits in a
 * "FAILED, awaiting manual retry" state for something to flip back), plus
 * PENDING→CANCELLED and FAILED→CANCELLED (no "cancel a not-yet-started or
 * already-failed run" endpoint exists — only rejectInstance's
 * AWAITING_APPROVAL→CANCELLED is wired to a route).
 *
 * DECISION (Option C — intentionally reserved, not implemented or removed):
 * this is a database-certification phase, not a feature phase, so adding a
 * cancel-pending/cancel-failed/manual-retry endpoint here would be exactly
 * the "unnecessary new feature" a certification phase should avoid. These
 * three transitions stay in the table as deliberately reserved capacity —
 * the state machine already models the future shape correctly, so adding
 * the corresponding endpoint later is a pure additive change, not a
 * migration. They are NOT bugs, NOT dead code to delete, and NOT silently
 * left ambiguous — see workflow-engine.reserved-transitions.test.ts for the
 * test that encodes this decision and will fail loudly if it ever silently
 * drifts (e.g. if RETRYING starts being set at the instance level without
 * this comment being updated).
 */
const VALID_TRANSITIONS: Record<WorkflowInstanceStatus, WorkflowInstanceStatus[]> = {
  PENDING: ['RUNNING', 'CANCELLED'], // CANCELLED here is reserved (see above)
  RUNNING: ['RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED'],
  AWAITING_APPROVAL: ['RUNNING', 'CANCELLED'], // CANCELLED here IS reachable, via rejectInstance
  FAILED: ['RETRYING', 'CANCELLED'], // both reserved (see above)
  RETRYING: ['RUNNING', 'FAILED'], // reserved — no code path currently sets an instance to RETRYING
  COMPLETED: [],
  CANCELLED: [],
};

/** Exported for unit testing (Phase 15 Section 34) — the pure state-machine rule, independent of persistence. */
export function assertTransition(from: WorkflowInstanceStatus, to: WorkflowInstanceStatus): void {
  if (from === to) return; // no-op transitions (e.g. RUNNING -> RUNNING between steps) are allowed
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(`WorkflowInstance cannot transition from ${from} to ${to}.`);
  }
}

const MAX_STEP_ATTEMPTS = 3;

export async function startWorkflow(params: {
  workspaceId: string;
  workflowDefinitionKey: string;
  businessProfileId?: string;
  triggeredByUserId?: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<WorkflowInstance> {
  const definition = await prisma.workflowDefinition.findFirst({
    where: { workspaceId: null, key: params.workflowDefinitionKey, status: 'ACTIVE', deletedAt: null },
    orderBy: { version: 'desc' },
  });
  if (!definition) throw new NotFoundError(`No active workflow definition "${params.workflowDefinitionKey}" found.`);

  // Idempotency (Phase 15 Section 14): a repeated request with the same key
  // returns the existing instance rather than creating a duplicate run.
  //
  // Phase 28 real-defect fix: a repeated call previously returned the
  // existing row as-is, even when it was left stuck at PENDING (never
  // started at all) by an EARLIER call that created the row but then threw
  // before any step ran (e.g. this process's step-handler registry wasn't
  // populated — see run-scheduler.ts's fix for the actual cause found this
  // phase). A caller that retries on failure (exactly what
  // job-queue.service.ts's retry/backoff does) would see that retry
  // reported as a silent SUCCEEDED, while the instance stayed stuck at
  // PENDING forever — real execution against a Phase 28 Docker container
  // (not a test) is what surfaced this: three real ScheduledWorkflow
  // occurrences each produced a permanently-PENDING WorkflowInstance.
  //
  // Deliberately narrow to PENDING only — NOT a blanket "resume any
  // non-terminal status" fix. RUNNING/RETRYING are intentionally left
  // unresumed here: safely resuming a crashed mid-execution instance needs
  // its own lease/heartbeat (WorkflowInstance has none, unlike Job), which
  // is a larger change out of this phase's scope; AWAITING_APPROVAL is
  // correctly paused for a human and must never be auto-resumed.
  //
  // `runToNextGate` itself owns the real safety here (its own PENDING
  // atomic claim, see that function's doc comment) — this call is safe to
  // make even when it races against the ORIGINAL creator's own
  // unconditional `runToNextGate` call below (a real regression found and
  // fixed while building this: two concurrent callers could otherwise both
  // pass a plain, unconditional PENDING->RUNNING check and both execute
  // the step loop, racing on WorkflowStepRun's unique constraint).
  if (params.idempotencyKey) {
    const existing = await prisma.workflowInstance.findFirst({
      where: { workspaceId: params.workspaceId, workflowDefinitionId: definition.id, idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      if (existing.status === 'PENDING') return runToNextGate(existing.id);
      return existing;
    }
  }

  let instance: WorkflowInstance;
  try {
    instance = await prisma.workflowInstance.create({
      data: {
        workspaceId: params.workspaceId,
        workflowDefinitionId: definition.id,
        businessProfileId: params.businessProfileId,
        triggeredByUserId: params.triggeredByUserId,
        status: 'PENDING',
        input: params.input as Prisma.InputJsonValue,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (err) {
    // Race: two concurrent requests with the same idempotency key. The
    // unique constraint on (workspaceId, workflowDefinitionId,
    // idempotencyKey) is the actual correctness guarantee; this just
    // returns the winner's row instead of surfacing a 500.
    //
    // Phase 18: a real concurrent-request test found that Prisma's driver
    // adapters (both the production @prisma/adapter-pg and this repo's
    // PGlite adapter) can surface the raw Postgres SQLSTATE '23505'
    // (unique_violation) on `err.code` instead of the query-engine-mapped
    // 'P2002' — the check below must accept either, or this recovery path
    // silently never fires and a genuine race becomes an unhandled 500.
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === '23505');
    if (isUniqueViolation && params.idempotencyKey) {
      const existing = await prisma.workflowInstance.findFirst({
        where: { workspaceId: params.workspaceId, workflowDefinitionId: definition.id, idempotencyKey: params.idempotencyKey },
      });
      if (existing) return existing;
    }
    throw err;
  }

  await trackEvent({ workspaceId: instance.workspaceId, userId: instance.triggeredByUserId ?? undefined, eventName: PRODUCT_EVENTS.WORKFLOW_CREATED, entityType: 'WorkflowInstance', entityId: instance.id });
  if (!(await hasWorkspaceEvent(instance.workspaceId, PRODUCT_EVENTS.FIRST_WORKFLOW_STARTED))) {
    await trackEvent({ workspaceId: instance.workspaceId, userId: instance.triggeredByUserId ?? undefined, eventName: PRODUCT_EVENTS.FIRST_WORKFLOW_STARTED, entityType: 'WorkflowInstance', entityId: instance.id });
  }

  return runToNextGate(instance.id);
}

/**
 * Runs steps in order, starting from `currentStepKey`, until the workflow
 * completes, fails, or reaches a step requiring human approval.
 */
export async function runToNextGate(workflowInstanceId: string): Promise<WorkflowInstance> {
  let instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: workflowInstanceId } });
  const definition = await prisma.workflowDefinition.findUniqueOrThrow({ where: { id: instance.workflowDefinitionId } });
  const steps = getWorkflowSteps(definition.key);

  if (instance.status === 'PENDING') {
    assertTransition(instance.status, 'RUNNING');
    // Real defect found and fixed this phase: this used to be a plain,
    // unconditional `update`. `startWorkflow`'s idempotency path can now
    // call `runToNextGate` on an existing PENDING instance to resume a
    // caller that previously crashed before running any step (see
    // `startWorkflow`'s own doc comment) — and `startWorkflow`'s ORIGINAL
    // creator call ALSO reaches this exact line unconditionally right
    // after `create()`. Two concurrent callers (the original creator and a
    // second request that observed the same row as PENDING before the
    // creator's own transition landed) could both pass this check and
    // both proceed into the step loop below, racing on
    // WorkflowStepRun's (workflowInstanceId, stepKey, attempt) unique
    // constraint — a real regression the existing Section 11 concurrency
    // test (marketing-autopilot.integration.test.ts) caught. This
    // `updateMany` is the one real atomic claim every caller funnels
    // through: only the caller whose write actually matches a still-PENDING
    // row may proceed to execute steps; every other concurrent caller sees
    // `count !== 1`, re-reads the (already advancing) row, and returns it
    // without touching the step loop — exactly the pre-fix "just return
    // the existing row" behavior for a genuine race.
    const claim = await prisma.workflowInstance.updateMany({ where: { id: instance.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date() } });
    instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    if (claim.count !== 1) return instance; // lost the claim race — another caller owns advancing this instance
  }

  if (instance.status !== 'RUNNING') {
    return instance; // AWAITING_APPROVAL / COMPLETED / FAILED / CANCELLED — nothing to advance
  }

  const startIndex = instance.currentStepKey ? steps.findIndex((s) => s.key === instance.currentStepKey) + 1 : 0;
  const accumulated: Record<string, unknown> = { ...(instance.input as Record<string, unknown>) };

  // Re-hydrate prior steps' outputs into the accumulator so a resumed run
  // (after an approval gate) has the full context, not just the input.
  const priorRuns = await prisma.workflowStepRun.findMany({
    where: { workflowInstanceId: instance.id, status: 'SUCCEEDED' },
    orderBy: { stepOrder: 'asc' },
  });
  for (const run of priorRuns) {
    accumulated[run.stepKey] = run.output;
  }

  for (let i = startIndex; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) break; // unreachable given the loop bound, but satisfies noUncheckedIndexedAccess honestly
    const ctx: StepContext = {
      workspaceId: instance.workspaceId,
      workflowInstanceId: instance.id,
      businessProfileId: instance.businessProfileId,
      triggeredByUserId: instance.triggeredByUserId,
      accumulated,
    };

    const stepResult = await runStepWithRetry(instance.id, step, ctx);

    if (!stepResult.ok) {
      instance = await prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'FAILED', currentStepKey: step.key, error: { step: step.key, message: stepResult.error } },
      });
      recordWorkflowExecution('failed');
      if (instance.triggeredByUserId) {
        await createNotification({
          workspaceId: instance.workspaceId,
          recipientUserId: instance.triggeredByUserId,
          category: 'AI',
          type: 'WORKFLOW_FAILED',
          title: 'A workflow run failed',
          body: `Failed at step "${step.key}".`,
          relatedEntityType: 'WorkflowInstance',
          relatedEntityId: instance.id,
        });
      }
      return instance;
    }

    accumulated[step.key] = stepResult.output;
    instance = await prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { currentStepKey: step.key },
    });

    if (stepResult.requiresApproval) {
      assertTransition(instance.status, 'AWAITING_APPROVAL');
      instance = await prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'AWAITING_APPROVAL' },
      });
      return instance;
    }
  }

  assertTransition(instance.status, 'COMPLETED');
  instance = await prisma.workflowInstance.update({
    where: { id: instance.id },
    data: { status: 'COMPLETED', completedAt: new Date(), output: accumulated as Prisma.InputJsonValue },
  });
  recordWorkflowExecution('succeeded');
  const isFirstWorkflowCompletion = !(await hasWorkspaceEvent(instance.workspaceId, PRODUCT_EVENTS.FIRST_WORKFLOW_COMPLETED));
  await trackEvent({ workspaceId: instance.workspaceId, userId: instance.triggeredByUserId ?? undefined, eventName: PRODUCT_EVENTS.WORKFLOW_COMPLETED, entityType: 'WorkflowInstance', entityId: instance.id });
  if (isFirstWorkflowCompletion) {
    await trackEvent({ workspaceId: instance.workspaceId, userId: instance.triggeredByUserId ?? undefined, eventName: PRODUCT_EVENTS.FIRST_WORKFLOW_COMPLETED, entityType: 'WorkflowInstance', entityId: instance.id });
  }
  if (instance.triggeredByUserId) {
    await createNotification({
      workspaceId: instance.workspaceId,
      recipientUserId: instance.triggeredByUserId,
      category: 'AI',
      type: 'WORKFLOW_COMPLETED',
      title: 'Your workflow run completed',
      relatedEntityType: 'WorkflowInstance',
      relatedEntityId: instance.id,
    });
    // Phase 26 Section 3: the strongest real activation signal — a
    // completed AI workflow run — advances onboarding automatically.
    // Idempotent/forward-only (advanceOnboardingStep no-ops if the
    // workspace is already past this step), so it is safe to call
    // unconditionally on every completion, not just the first.
    await advanceOnboardingStep(instance.workspaceId, 'first_workflow_run', instance.triggeredByUserId);
    // Phase 29 real gap closed: the audit found 'plan_chosen'/'team_invited'/
    // 'first_workflow_run'/'completed' were unreachable from any UI path —
    // the frontend only ever implemented the first two of six backend
    // steps. Rather than build bespoke UI for a distinct "choose your plan"
    // moment (the FREE plan is already auto-assigned at workspace creation
    // — there is no real choice to present) or a mandatory "invite your
    // team" gate (explicitly optional per this service's own
    // NEXT_ACTION_COPY, and irrelevant to this MVP's target persona: a
    // solo small-business owner), completion is reached the same
    // idempotent, forward-only way — advanceOnboardingStep's target-index
    // check allows jumping straight from 'profile_completed' to
    // 'first_workflow_run' (skipping the two steps that have no real,
    // distinct product moment for this persona) and now straight on to
    // 'completed', the real "time to first value" milestone this MVP
    // actually cares about.
    await advanceOnboardingStep(instance.workspaceId, 'completed', instance.triggeredByUserId);
  }
  return instance;
}

/** Exported for direct testing (Phase 18 Section 10) — retry/failure behavior needs a real DB (writes WorkflowStepRun rows per attempt), so it is exercised via an integration test, not a pure unit test. */
export async function runStepWithRetry(
  workflowInstanceId: string,
  step: { key: string; order: number; handler: (ctx: StepContext) => Promise<{ output: unknown; requiresApproval?: boolean }> },
  ctx: StepContext
): Promise<{ ok: true; output: unknown; requiresApproval?: boolean } | { ok: false; error: string }> {
  let lastError: unknown;

  // Real defect found and fixed while building Phase 29's retry feature:
  // `attempt` must be unique per (workflowInstanceId, stepKey) for the
  // instance's entire lifetime (WorkflowStepRun's real unique constraint),
  // not just within one call to this function. The in-process
  // retry-with-backoff loop below always ran within a single
  // runToNextGate call before this phase, so starting at 1 every time was
  // never wrong — until `retryInstance` introduced a genuine SECOND call
  // to runToNextGate for the SAME step after a real FAILED terminal state,
  // which collided with the first call's own attempt=1..N rows. Starting
  // from the real max existing attempt for this exact step makes every
  // call — the original run or any later retry — safe to invoke, however
  // many times, without ever violating the unique constraint.
  const priorAttempts = await prisma.workflowStepRun.aggregate({
    where: { workflowInstanceId, stepKey: step.key },
    _max: { attempt: true },
  });
  const startAttempt = (priorAttempts._max.attempt ?? 0) + 1;

  for (let localAttempt = 1; localAttempt <= MAX_STEP_ATTEMPTS; localAttempt += 1) {
    const attempt = startAttempt + localAttempt - 1; // the real, globally-unique DB value for this step's lifetime
    const stepRun = await prisma.workflowStepRun.create({
      data: {
        workflowInstanceId,
        stepKey: step.key,
        stepOrder: step.order,
        status: 'RUNNING',
        attempt,
        input: ctx.accumulated as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    try {
      const result = await step.handler(ctx);
      await prisma.workflowStepRun.update({
        where: { id: stepRun.id },
        data: { status: 'SUCCEEDED', output: result.output as Prisma.InputJsonValue, completedAt: new Date() },
      });
      return { ok: true, output: result.output, requiresApproval: result.requiresApproval };
    } catch (err) {
      lastError = err;
      const transient = isTransientError(err);
      await prisma.workflowStepRun.update({
        where: { id: stepRun.id },
        data: {
          status: transient && localAttempt < MAX_STEP_ATTEMPTS ? 'RETRYING' : 'FAILED',
          error: { message: errorMessage(err) },
          completedAt: new Date(),
        },
      });
      if (!transient) break; // Phase 15 Section 15: never blindly retry permanent failures
      if (localAttempt < MAX_STEP_ATTEMPTS) {
        await sleep(2 ** localAttempt * 100); // simple exponential backoff
      }
    }
  }

  return { ok: false, error: errorMessage(lastError) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown step failure';
}

/**
 * Phase 15 Section 15: never blindly retry invalid input, authorization
 * failure, malformed business data, or permanently invalid AI output —
 * only transient (network/upstream) failures. AppError subclasses other
 * than UpstreamProviderError are treated as permanent by construction
 * (they represent a definite business-rule or validation failure).
 */
function isTransientError(err: unknown): boolean {
  // Phase 18: previously compared `.name === 'UpstreamProviderError'`, which
  // could never match — AppError's base constructor hardcoded `this.name =
  // 'AppError'` for every subclass (now fixed to `new.target.name`), so this
  // branch silently never fired and transient AI/upstream failures always
  // went straight to FAILED on the first attempt, never retried. Checking
  // `instanceof` directly is also correct regardless of `.name`'s value.
  const name = (err as { name?: string }).name;
  return err instanceof UpstreamProviderError || name === 'AbortError' || (err instanceof Error && /timeout|ECONNRESET|ETIMEDOUT/i.test(err.message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type InstanceWithDetail = Prisma.WorkflowInstanceGetPayload<{ include: { stepRuns: true; contentAssets: true } }>;

async function getInstanceWithDetail(workspaceId: string, instanceId: string): Promise<InstanceWithDetail> {
  const instance = await prisma.workflowInstance.findFirst({
    where: { id: instanceId, workspaceId },
    include: { stepRuns: { orderBy: { stepOrder: 'asc' } }, contentAssets: { orderBy: { day: 'asc' } } },
  });
  if (!instance) throw new NotFoundError();
  return instance;
}

/**
 * Phase 18: approve/reject previously returned the bare Prisma row from
 * `update()` — no `contentAssets`/`stepRuns` relations — while the frontend
 * (ContentCalendarReview.tsx) sets that response directly as its full
 * instance state and immediately renders `instance.contentAssets.slice()`.
 * A confirmed, 100%-reproducible crash on the core product loop's own
 * "approve my plan" button: `Cannot read properties of undefined (reading
 * 'slice')`, unmounting the entire app (no error boundary exists). Fixed at
 * the API contract itself — every path that returns a WorkflowInstance to a
 * client now includes the same relations `getInstance` always has, so no
 * caller can be surprised by a partial shape again.
 */
/**
 * Phase 20 Section 8.2: `updateMany` with `status: 'AWAITING_APPROVAL'` in
 * the WHERE clause makes this an atomic conditional state transition — the
 * read-the-current-status check and the write happen as a single
 * database statement, so two concurrent approval requests can never both
 * "win". Whichever transaction's UPDATE actually executes first takes the
 * row lock and flips status away from AWAITING_APPROVAL; the second
 * transaction's UPDATE then matches zero rows (it re-evaluates its WHERE
 * clause against the now-changed row, not a stale pre-lock read), so
 * `count` is 0 and it falls through to exactly the same 409 a sequential
 * repeated-approval already produces. The previous
 * find-then-assertTransition-then-update sequence could not close this
 * race: two concurrent reads could both observe AWAITING_APPROVAL before
 * either write landed.
 */
export async function approveInstance(workspaceId: string, instanceId: string): Promise<InstanceWithDetail> {
  const existing = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
  if (!existing) throw new NotFoundError();

  const claim = await prisma.workflowInstance.updateMany({
    where: { id: instanceId, workspaceId, status: 'AWAITING_APPROVAL' },
    data: { status: 'RUNNING', outcomeSignal: 'ACCEPTED' },
  });

  if (claim.count === 0) {
    // Either a genuinely invalid transition, or a concurrent request
    // already won this exact race — both correctly produce the same 409;
    // re-fetch for an accurate message rather than trusting the pre-race read.
    const current = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
    throw new InvalidStateTransitionError(`WorkflowInstance cannot transition from ${current?.status ?? existing.status} to RUNNING.`);
  }

  await runToNextGate(instanceId);
  return getInstanceWithDetail(workspaceId, instanceId);
}

export async function rejectInstance(workspaceId: string, instanceId: string): Promise<InstanceWithDetail> {
  const existing = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
  if (!existing) throw new NotFoundError();

  // Same atomic conditional-transition pattern as approveInstance above.
  const claim = await prisma.workflowInstance.updateMany({
    where: { id: instanceId, workspaceId, status: 'AWAITING_APPROVAL' },
    data: { status: 'CANCELLED', outcomeSignal: 'DISMISSED' },
  });

  if (claim.count === 0) {
    const current = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
    throw new InvalidStateTransitionError(`WorkflowInstance cannot transition from ${current?.status ?? existing.status} to CANCELLED.`);
  }

  return getInstanceWithDetail(workspaceId, instanceId);
}

/**
 * Phase 29 Section 10: explicit, audited failure recovery —
 * FAILED -> RETRYING -> RUNNING -> (COMPLETED | FAILED again). Reuses the
 * `VALID_TRANSITIONS` states this engine has reserved since Phase 15
 * (`FAILED: ['RETRYING', ...]`, `RETRYING: ['RUNNING', 'FAILED']`) —
 * previously real, defined, but genuinely unreachable from any code path
 * (the audit that started this phase confirmed it). Real defect avoided
 * while building this: `runToNextGate`'s resume logic (`currentStepKey`
 * index + 1) is correct for the AWAITING_APPROVAL resume case
 * (`currentStepKey` there is the step that just SUCCEEDED), but a FAILED
 * instance's `currentStepKey` is the step that FAILED — resuming naively
 * would silently SKIP re-attempting it. This rewinds `currentStepKey` to
 * the previous (last successful) step first, so the existing +1 resume
 * logic correctly re-lands on the failed step instead of skipping past it.
 */
export async function retryInstance(workspaceId: string, instanceId: string, actorUserId: string, reason: string): Promise<InstanceWithDetail> {
  const existing = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
  if (!existing) throw new NotFoundError();

  const definition = await prisma.workflowDefinition.findUniqueOrThrow({ where: { id: existing.workflowDefinitionId } });
  const steps = getWorkflowSteps(definition.key);
  const failedStepIndex = existing.currentStepKey ? steps.findIndex((s) => s.key === existing.currentStepKey) : -1;
  const rewindToStepKey = failedStepIndex > 0 ? (steps[failedStepIndex - 1]?.key ?? null) : null;

  const claim = await prisma.workflowInstance.updateMany({
    where: { id: instanceId, workspaceId, status: 'FAILED' },
    data: { status: 'RETRYING', currentStepKey: rewindToStepKey },
  });
  if (claim.count === 0) {
    const current = await prisma.workflowInstance.findFirst({ where: { id: instanceId, workspaceId } });
    throw new InvalidStateTransitionError(`WorkflowInstance cannot transition from ${current?.status ?? existing.status} to RETRYING.`);
  }

  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId,
      action: 'UPDATE',
      entityType: 'WorkflowInstance',
      entityId: instanceId,
      previousValue: { status: 'FAILED', currentStepKey: existing.currentStepKey },
      newValue: { status: 'RETRYING', reason },
    },
  });
  recordWorkflowRetry();
  if (existing.triggeredByUserId) {
    await createNotification({
      workspaceId,
      recipientUserId: existing.triggeredByUserId,
      category: 'AI',
      type: 'WORKFLOW_RETRYING',
      title: 'Retrying your failed workflow run',
      body: reason,
      relatedEntityType: 'WorkflowInstance',
      relatedEntityId: instanceId,
    });
  }

  // RETRYING -> RUNNING is a real, separate atomic transition (matching
  // the reserved VALID_TRANSITIONS shape) before re-entering the real step
  // loop — the SAME runToNextGate every other execution path uses, not a
  // parallel "retry engine."
  await prisma.workflowInstance.updateMany({ where: { id: instanceId, workspaceId, status: 'RETRYING' }, data: { status: 'RUNNING' } });
  await runToNextGate(instanceId);
  return getInstanceWithDetail(workspaceId, instanceId);
}

export async function getInstance(workspaceId: string, instanceId: string): Promise<InstanceWithDetail> {
  return getInstanceWithDetail(workspaceId, instanceId);
}

/**
 * Phase 19 / Phase 18 Section 27: closes the "resume my existing plan" gap —
 * previously a user who navigated away from Marketing Autopilot after
 * generating a plan had no way to see it again; the frontend always
 * defaulted to the "start a new plan" form. Returns the most recent
 * instance of the given workflow definition for this workspace, or `null`
 * if none exists yet (a genuinely new workspace) — the caller distinguishes
 * "nothing to resume" from "not found" this way rather than a 404.
 */
export async function getLatestInstance(workspaceId: string, workflowDefinitionKey: string): Promise<InstanceWithDetail | null> {
  const definition = await prisma.workflowDefinition.findFirst({
    where: { workspaceId: null, key: workflowDefinitionKey, status: 'ACTIVE', deletedAt: null },
    orderBy: { version: 'desc' },
  });
  if (!definition) return null;

  const instance = await prisma.workflowInstance.findFirst({
    where: { workspaceId, workflowDefinitionId: definition.id },
    orderBy: { createdAt: 'desc' },
    include: { stepRuns: { orderBy: { stepOrder: 'asc' } }, contentAssets: { orderBy: { day: 'asc' } } },
  });
  return instance;
}
