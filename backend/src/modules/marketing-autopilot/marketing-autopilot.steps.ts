import type { BusinessProfile } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ValidationError } from '../../common/errors/app-error';
import { getAIProvider as resolveProvider } from '../../infrastructure/ai/provider-router';
import { assertSufficientCredits, recordUsage } from '../billing/credit-ledger.service';
import { checkAndTriggerUsageAlerts } from '../billing/usage-alert.service';
import { registerWorkflowSteps, type StepContext, type StepResult } from '../workflows/step-handler.registry';
import { calendarOutputSchema, pillarsOutputSchema, strategyOutputSchema } from './marketing-autopilot.schemas';
import { trackEvent, hasWorkspaceEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

const CREDIT_COSTS = { strategy: 5, pillars: 5, calendar: 10 } as const;

async function loadBusinessContext(businessProfileId: string | null): Promise<BusinessProfile> {
  if (!businessProfileId) {
    throw new ValidationError([{ field: 'businessProfileId', code: 'REQUIRED', message: 'A Business Profile is required for this workflow.' }]);
  }
  const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId, deletedAt: null } });
  if (!profile) {
    throw new ValidationError([{ field: 'businessProfileId', code: 'NOT_FOUND', message: 'Business Profile not found.' }]);
  }
  return profile;
}

// ---------------------------------------------------------------------------
// STEP 01 — Validate Business Context (deterministic, not AI)
// ---------------------------------------------------------------------------
async function step01ValidateContext(ctx: StepContext): Promise<StepResult> {
  const profile = await loadBusinessContext(ctx.businessProfileId);

  const missing: Array<{ field: string; code: string; message: string }> = [];
  if (!profile.name.trim()) missing.push({ field: 'name', code: 'REQUIRED', message: 'Business name is required.' });
  if (!profile.industry?.trim()) missing.push({ field: 'industry', code: 'REQUIRED', message: 'Industry is required.' });
  if (missing.length > 0) {
    throw new ValidationError(missing); // permanent failure — never retried (Section 15)
  }

  return {
    output: {
      businessProfileId: profile.id,
      businessName: profile.name,
      industry: profile.industry,
      targetAudience: profile.targetAudience,
      offerings: profile.offerings,
      contentLanguage: profile.contentLanguage,
    },
  };
}

// ---------------------------------------------------------------------------
// STEP 02 — Build Marketing Strategy (AI)
// ---------------------------------------------------------------------------
async function step02BuildStrategy(ctx: StepContext): Promise<StepResult> {
  const validated = ctx.accumulated['validate_context'] as Record<string, unknown>;
  const input = ctx.accumulated as { objective?: string };

  await assertSufficientCredits(ctx.workspaceId, CREDIT_COSTS.strategy);

  const provider = resolveProvider();
  const result = await provider.complete({
    actionType: 'AUTOMATION_RUN',
    promptKey: 'marketing.strategy',
    context: { ...validated, objective: input.objective ?? 'bookings' },
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
  });

  const parsed = strategyOutputSchema.safeParse(JSON.parse(result.outputJson));
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), code: i.code.toUpperCase(), message: i.message }))
    );
  }

  await recordUsage({
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
    actionType: 'AUTOMATION_RUN',
    creditsConsumed: CREDIT_COSTS.strategy,
    relatedEntityType: 'WorkflowInstance',
    relatedEntityId: ctx.workflowInstanceId,
    modelProvider: result.provider,
    modelName: result.model ?? undefined,
    latencyMs: result.latencyMs,
  });
  await checkAndTriggerUsageAlerts(ctx.workspaceId);

  return { output: parsed.data };
}

// ---------------------------------------------------------------------------
// STEP 03 — Generate Content Pillars (AI)
// ---------------------------------------------------------------------------
async function step03GeneratePillars(ctx: StepContext): Promise<StepResult> {
  const validated = ctx.accumulated['validate_context'] as Record<string, unknown>;
  const strategy = ctx.accumulated['build_strategy'];

  await assertSufficientCredits(ctx.workspaceId, CREDIT_COSTS.pillars);

  const provider = resolveProvider();
  const result = await provider.complete({
    actionType: 'AUTOMATION_RUN',
    promptKey: 'marketing.pillars',
    context: { ...validated, strategy },
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
  });

  const parsed = pillarsOutputSchema.safeParse(JSON.parse(result.outputJson));
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), code: i.code.toUpperCase(), message: i.message }))
    );
  }

  await recordUsage({
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
    actionType: 'AUTOMATION_RUN',
    creditsConsumed: CREDIT_COSTS.pillars,
    relatedEntityType: 'WorkflowInstance',
    relatedEntityId: ctx.workflowInstanceId,
    modelProvider: result.provider,
    modelName: result.model ?? undefined,
    latencyMs: result.latencyMs,
  });
  await checkAndTriggerUsageAlerts(ctx.workspaceId);

  return { output: parsed.data };
}

// ---------------------------------------------------------------------------
// STEP 04 — Generate 30-Day Calendar (AI)
// ---------------------------------------------------------------------------
async function step04GenerateCalendar(ctx: StepContext): Promise<StepResult> {
  const validated = ctx.accumulated['validate_context'] as Record<string, unknown>;
  const strategy = ctx.accumulated['build_strategy'];
  const pillars = ctx.accumulated['generate_pillars'];
  const input = ctx.accumulated as { platforms?: string[] };

  await assertSufficientCredits(ctx.workspaceId, CREDIT_COSTS.calendar);

  const provider = resolveProvider();
  const result = await provider.complete({
    actionType: 'AUTOMATION_RUN',
    promptKey: 'marketing.calendar',
    context: { ...validated, strategy, pillars, platforms: input.platforms ?? ['instagram'] },
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
  });

  const parsed = calendarOutputSchema.safeParse(JSON.parse(result.outputJson));
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), code: i.code.toUpperCase(), message: i.message }))
    );
  }

  await recordUsage({
    workspaceId: ctx.workspaceId,
    userId: ctx.triggeredByUserId ?? undefined,
    actionType: 'AUTOMATION_RUN',
    creditsConsumed: CREDIT_COSTS.calendar,
    relatedEntityType: 'WorkflowInstance',
    relatedEntityId: ctx.workflowInstanceId,
    modelProvider: result.provider,
    modelName: result.model ?? undefined,
    latencyMs: result.latencyMs,
  });
  await checkAndTriggerUsageAlerts(ctx.workspaceId);

  return { output: parsed.data };
}

// ---------------------------------------------------------------------------
// STEP 05 — Validate Generated Output (deterministic, not AI)
// Phase 15 Section 18/20: AI is never the source of structural truth —
// cross-checks are pure code, independent of the provider that produced it.
// ---------------------------------------------------------------------------
function step05ValidateOutput(ctx: StepContext): Promise<StepResult> {
  const pillars = ctx.accumulated['generate_pillars'] as { pillars: Array<{ key: string }> };
  const calendar = ctx.accumulated['generate_calendar'] as { items: Array<{ pillarKey: string; caption: string }> };

  const validPillarKeys = new Set(pillars.pillars.map((p) => p.key));
  const errors: Array<{ field: string; code: string; message: string }> = [];

  calendar.items.forEach((item, idx) => {
    const itemNumber = String(idx + 1);
    if (!validPillarKeys.has(item.pillarKey)) {
      errors.push({
        field: `items[${itemNumber}].pillarKey`,
        code: 'INVALID_REFERENCE',
        message: `Calendar item ${itemNumber} references unknown pillar "${item.pillarKey}".`,
      });
    }
    if (!item.caption.trim()) {
      errors.push({ field: `items[${itemNumber}].caption`, code: 'REQUIRED', message: `Calendar item ${itemNumber} has an empty caption.` });
    }
  });

  if (errors.length > 0) {
    throw new ValidationError(errors); // permanent — the generated batch is structurally invalid, never retried as-is
  }

  return Promise.resolve({ output: { validated: true, itemCount: calendar.items.length } });
}

// ---------------------------------------------------------------------------
// STEP 06 — Persist Content Assets (deterministic DB writes, not AI)
// ---------------------------------------------------------------------------
async function step06PersistAssets(ctx: StepContext): Promise<StepResult> {
  const calendar = ctx.accumulated['generate_calendar'] as {
    items: Array<{
      day: number;
      platform: string;
      contentType: string;
      pillarKey: string;
      topic: string;
      hook: string;
      keyMessage: string;
      caption: string;
      cta: string;
      visualDirection: string;
    }>;
  };

  // Phase 20 Section 8.1: `upsert` on the real domain-identity constraint
  // (workflowInstanceId, day, platform, contentType) rather than `create`
  // — makes a retried persist_assets step (a transient-error retry of THIS
  // step specifically, not the whole workflow) idempotent: re-running it
  // re-affirms the same rows instead of creating a second set. The `update`
  // clause intentionally only refreshes content fields, never `status`
  // (a retry must never silently revert a human's APPROVED/edited asset
  // back to a freshly-generated DRAFT).
  const created = await prisma.$transaction(
    calendar.items.map((item) =>
      prisma.contentAsset.upsert({
        where: {
          workflowInstanceId_day_platform_contentType: {
            workflowInstanceId: ctx.workflowInstanceId,
            day: item.day,
            platform: item.platform,
            contentType: item.contentType,
          },
        },
        create: {
          workspaceId: ctx.workspaceId,
          workflowInstanceId: ctx.workflowInstanceId,
          businessProfileId: ctx.businessProfileId,
          day: item.day,
          platform: item.platform,
          contentType: item.contentType,
          pillarKey: item.pillarKey,
          topic: item.topic,
          hook: item.hook,
          keyMessage: item.keyMessage,
          caption: item.caption,
          cta: item.cta,
          visualDirection: item.visualDirection,
          status: 'DRAFT',
        },
        update: {
          pillarKey: item.pillarKey,
          topic: item.topic,
          hook: item.hook,
          keyMessage: item.keyMessage,
          caption: item.caption,
          cta: item.cta,
          visualDirection: item.visualDirection,
        },
      })
    )
  );

  if (!(await hasWorkspaceEvent(ctx.workspaceId, PRODUCT_EVENTS.FIRST_CONTENT_GENERATED))) {
    await trackEvent({ workspaceId: ctx.workspaceId, userId: ctx.triggeredByUserId ?? undefined, eventName: PRODUCT_EVENTS.FIRST_CONTENT_GENERATED, entityType: 'WorkflowInstance', entityId: ctx.workflowInstanceId, properties: { count: created.length } });
  }

  return { output: { contentAssetIds: created.map((c) => c.id), count: created.length } };
}

// ---------------------------------------------------------------------------
// STEP 07 — Await Human Approval (batch-level gate; per-item approve/edit
// happens independently via the content-assets resource — Phase 15 Section
// 13's explicit "workflow completed" != "content approved" distinction)
// ---------------------------------------------------------------------------
function step07AwaitApproval(ctx: StepContext): Promise<StepResult> {
  const persisted = ctx.accumulated['persist_assets'] as { count: number };
  const strategy = ctx.accumulated['build_strategy'];
  return Promise.resolve({
    output: { summary: `${String(persisted.count)} content assets generated and ready for review.`, strategy },
    requiresApproval: true,
  });
}

registerWorkflowSteps('marketing-autopilot', [
  { key: 'validate_context', order: 1, handler: step01ValidateContext },
  { key: 'build_strategy', order: 2, handler: step02BuildStrategy },
  { key: 'generate_pillars', order: 3, handler: step03GeneratePillars },
  { key: 'generate_calendar', order: 4, handler: step04GenerateCalendar },
  { key: 'validate_output', order: 5, handler: step05ValidateOutput },
  { key: 'persist_assets', order: 6, handler: step06PersistAssets },
  { key: 'await_approval', order: 7, handler: step07AwaitApproval },
]);
