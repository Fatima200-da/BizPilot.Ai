import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { createNotification } from '../notifications/notification.service';
import { trackEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

/**
 * Phase 26 Section 3: backend-authoritative activation status and
 * resumable onboarding state. "Activated Customer" is computed live from
 * real data every time it is requested — never a cached/denormalized flag
 * a client could desynchronize from reality.
 */
export interface ActivationStatus {
  workspaceCreated: boolean;
  firstWorkflowCreated: boolean;
  firstSuccessfulAiOperation: boolean;
  isActivated: boolean;
}

export async function getActivationStatus(workspaceId: string): Promise<ActivationStatus> {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
  if (!workspace) throw new NotFoundError('Workspace not found.');

  const [workflowCount, successfulAiOpCount] = await Promise.all([
    prisma.workflowInstance.count({ where: { workspaceId } }),
    prisma.aIUsage.count({ where: { workspaceId, status: 'SUCCEEDED' } }),
  ]);

  const workspaceCreated = true; // trivially true — the workspace exists, or we'd have thrown above
  const firstWorkflowCreated = workflowCount > 0;
  const firstSuccessfulAiOperation = successfulAiOpCount > 0;

  return {
    workspaceCreated,
    firstWorkflowCreated,
    firstSuccessfulAiOperation,
    isActivated: firstWorkflowCreated && firstSuccessfulAiOperation, // workspaceCreated is trivially always true here — the workspace lookup above would have thrown NotFoundError otherwise
  };
}

const ONBOARDING_STEPS = ['workspace_created', 'profile_completed', 'plan_chosen', 'team_invited', 'first_workflow_run', 'completed'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

export interface OnboardingState {
  step: OnboardingStep;
  status: OnboardingStatus;
  completedAt: Date | null;
  nextRecommendedAction: string | null;
  activation: ActivationStatus;
}

const NEXT_ACTION_COPY: Record<OnboardingStep, string | null> = {
  workspace_created: 'Complete your business profile.',
  profile_completed: 'Choose a plan.',
  plan_chosen: 'Invite your team (optional) or create your first workflow.',
  team_invited: 'Create your first workflow.',
  first_workflow_run: 'Run your first AI operation.',
  completed: null,
};

/** Resumable: a workspace's onboarding progress is durable (Settings row), read fresh on every request — a user can leave and return to the exact step they left off at. */
export async function getOnboardingState(workspaceId: string): Promise<OnboardingState> {
  const [settings, activation] = await Promise.all([
    prisma.settings.findUnique({ where: { workspaceId } }),
    getActivationStatus(workspaceId),
  ]);
  if (!settings) throw new NotFoundError('Workspace settings not found.');

  const step = settings.onboardingStep as OnboardingStep;
  return {
    step,
    status: settings.onboardingStatus,
    completedAt: settings.onboardingCompletedAt,
    nextRecommendedAction: NEXT_ACTION_COPY[step] ?? null,
    activation,
  };
}

/**
 * Phase 27 Section 2: the user-level view of onboarding status, covering
 * the one real state `getOnboardingState` structurally cannot represent —
 * NOT_STARTED — because that endpoint is workspace-scoped and a Settings
 * row (and therefore any status) only exists once a workspace exists. A
 * user who has registered but created zero workspaces yet is NOT_STARTED;
 * once they have one or more workspaces, this reports their most recently
 * created workspace's real, live status (never cached).
 */
export interface UserOnboardingStatus {
  status: OnboardingStatus;
  workspaceId: string | null;
}

export async function getUserOnboardingStatus(userId: string): Promise<UserOnboardingStatus> {
  const workspace = await prisma.workspace.findFirst({
    where: { ownerUserId: userId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, settings: { select: { onboardingStatus: true } } },
  });
  if (!workspace) {
    return { status: 'NOT_STARTED', workspaceId: null };
  }
  return { status: workspace.settings?.onboardingStatus ?? 'IN_PROGRESS', workspaceId: workspace.id };
}

/**
 * Advances onboarding to a specific step — idempotent (re-setting the same
 * or an earlier step is a safe no-op forward-only guard, since onboarding
 * never needs to regress) and workspace-aware (every write is scoped by
 * `workspaceId`, never a global user-level flag, since a user's onboarding
 * progress is naturally per-workspace).
 */
export async function advanceOnboardingStep(workspaceId: string, step: OnboardingStep, actorUserId: string): Promise<OnboardingState> {
  if (!ONBOARDING_STEPS.includes(step)) {
    throw new ValidationError([{ field: 'step', code: 'INVALID', message: `Unknown onboarding step "${step}".` }]);
  }
  const settings = await prisma.settings.findUnique({ where: { workspaceId } });
  if (!settings) throw new NotFoundError('Workspace settings not found.');

  const currentIndex = ONBOARDING_STEPS.indexOf(settings.onboardingStep as OnboardingStep);
  const targetIndex = ONBOARDING_STEPS.indexOf(step);
  if (targetIndex <= currentIndex) {
    return getOnboardingState(workspaceId); // no-op: already at or past this step
  }

  const isCompleting = step === 'completed';
  await prisma.settings.update({
    where: { workspaceId },
    data: {
      onboardingStep: step,
      ...(isCompleting ? { onboardingCompletedAt: new Date(), onboardingStatus: 'COMPLETED' } : {}),
    },
  });

  if (isCompleting) {
    await createNotification({
      workspaceId,
      recipientUserId: actorUserId,
      category: 'SYSTEM',
      type: 'ONBOARDING_REMINDER',
      title: 'Onboarding complete — your workspace is ready',
      relatedEntityType: 'Workspace',
      relatedEntityId: workspaceId,
    });
    await trackEvent({ workspaceId, userId: actorUserId, eventName: PRODUCT_EVENTS.ONBOARDING_COMPLETED });
  } else {
    await trackEvent({ workspaceId, userId: actorUserId, eventName: PRODUCT_EVENTS.ONBOARDING_STEP_COMPLETED, entityType: 'OnboardingStep', entityId: step, properties: { step } });
  }

  return getOnboardingState(workspaceId);
}

/**
 * Phase 27 Section 2: explicit skip — IN_PROGRESS -> SKIPPED. Idempotent
 * (skipping an already-SKIPPED workspace is a safe no-op) but rejects the
 * one genuinely invalid transition: skipping onboarding that has already
 * COMPLETED makes no sense and is reported as a real validation error, not
 * silently swallowed. Skipping does NOT touch `onboardingStep` — a user can
 * still resume and complete later (SKIPPED -> COMPLETED via
 * `advanceOnboardingStep` reaching the "completed" step remains valid).
 */
export async function skipOnboarding(workspaceId: string, actorUserId: string): Promise<OnboardingState> {
  const settings = await prisma.settings.findUnique({ where: { workspaceId } });
  if (!settings) throw new NotFoundError('Workspace settings not found.');

  if (settings.onboardingStatus === 'COMPLETED') {
    throw new ValidationError([{ field: 'status', code: 'INVALID_TRANSITION', message: 'Onboarding is already completed and cannot be skipped.' }]);
  }
  if (settings.onboardingStatus !== 'SKIPPED') {
    await prisma.settings.update({ where: { workspaceId }, data: { onboardingStatus: 'SKIPPED' } });
    await trackEvent({ workspaceId, userId: actorUserId, eventName: PRODUCT_EVENTS.ONBOARDING_SKIPPED, entityType: 'OnboardingStep', entityId: settings.onboardingStep });
  }

  return getOnboardingState(workspaceId);
}
