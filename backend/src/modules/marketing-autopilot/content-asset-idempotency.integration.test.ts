import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { getWorkflowSteps } from '../workflows/step-handler.registry';
import type { StepContext, StepHandler } from '../workflows/step-handler.registry';

interface CalendarItem {
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
}
import { registerTestUser, createTestWorkspace, cleanupTestUser, ensureSeeded } from '../../testing/integration-helpers';
import './marketing-autopilot.steps'; // side effect: registers step handlers

/**
 * Phase 20 Section 8.1: regression coverage for the ContentAsset domain-
 * identity fix. `persist_assets` now upserts on
 * (workflowInstanceId, day, platform, contentType) instead of blindly
 * creating — this proves a retried step (the real scenario: a transient
 * error detected after the step's own transaction committed but before it
 * successfully returns to the engine) does not create a duplicate batch,
 * and does not silently discard a human's edit made between the two
 * attempts' worth of DB state.
 */
describe('ContentAsset idempotency (integration)', () => {
  let workspaceId: string;
  let email: string;
  let businessProfileId: string;
  let definitionId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const user = await registerTestUser('Idempotency Test Owner');
    email = user.email;
    const workspace = await createTestWorkspace(user.accessToken, 'Idempotency Test Workspace');
    workspaceId = workspace.workspaceId;

    const profile = await prisma.businessProfile.create({
      data: { workspaceId, name: 'Idempotency Biz', industry: 'Test', contentLanguage: 'AZ' },
    });
    businessProfileId = profile.id;

    const definition = await prisma.workflowDefinition.findFirstOrThrow({ where: { workspaceId: null, key: 'marketing-autopilot' } });
    definitionId = definition.id;
  });

  afterAll(async () => {
    await cleanupTestUser(email);
  });

  /** Each test gets its own fresh WorkflowInstance — sharing one across tests would let an earlier test's 30-day batch collide with a later test's own day numbers. */
  async function freshInstanceId(): Promise<string> {
    const instance = await prisma.workflowInstance.create({
      data: { workspaceId, workflowDefinitionId: definitionId, businessProfileId, status: 'RUNNING', input: {} },
    });
    return instance.id;
  }

  function calendarItem(day: number, overrides: Partial<{ caption: string; platform: string; contentType: string }> = {}): CalendarItem {
    return {
      day,
      platform: overrides.platform ?? 'instagram',
      contentType: overrides.contentType ?? 'single_post',
      pillarKey: 'awareness',
      topic: `Day ${String(day)} topic`,
      hook: 'A hook',
      keyMessage: 'A key message',
      caption: overrides.caption ?? `Original caption for day ${String(day)}`,
      cta: 'Book now',
      visualDirection: 'Bright, on-brand photo',
    };
  }

  function ctxWithCalendar(instanceId: string, items: CalendarItem[]): StepContext {
    return {
      workspaceId,
      workflowInstanceId: instanceId,
      businessProfileId,
      triggeredByUserId: null,
      accumulated: { generate_calendar: { items } },
    };
  }

  function getPersistAssetsHandler(): StepHandler {
    const step = getWorkflowSteps('marketing-autopilot').find((s) => s.key === 'persist_assets');
    if (!step) throw new Error('persist_assets step not registered');
    return step.handler;
  }

  it('running persist_assets twice with identical input produces exactly 30 rows, not 60', async () => {
    const instanceId = await freshInstanceId();
    const items = Array.from({ length: 30 }, (_, i) => calendarItem(i + 1));
    const handler = getPersistAssetsHandler();

    await handler(ctxWithCalendar(instanceId, items));
    const afterFirst = await prisma.contentAsset.count({ where: { workflowInstanceId: instanceId } });
    expect(afterFirst).toBe(30);

    // Simulates the real retry scenario: the engine re-invokes the same
    // step from scratch after classifying a failure as transient.
    await handler(ctxWithCalendar(instanceId, items));
    const afterSecond = await prisma.contentAsset.count({ where: { workflowInstanceId: instanceId } });
    expect(afterSecond).toBe(30); // NOT 60 — this is the bug Phase 19 found and did not fix
  });

  it('a retry does not silently overwrite a human edit or approval made between attempts', async () => {
    const instanceId = await freshInstanceId();
    const items = Array.from({ length: 3 }, (_, i) => calendarItem(i + 1));
    const handler = getPersistAssetsHandler();
    await handler(ctxWithCalendar(instanceId, items));

    const day1 = await prisma.contentAsset.findFirstOrThrow({ where: { workflowInstanceId: instanceId, day: 1 } });
    await prisma.contentAsset.update({
      where: { id: day1.id },
      data: { status: 'APPROVED', editedCaption: 'Human-edited caption', approvedAt: new Date() },
    });

    // Re-run persist_assets (e.g. an upstream retry replaying the whole
    // step) with the AI's original (unedited) generated content again.
    await handler(ctxWithCalendar(instanceId, items));

    const day1After = await prisma.contentAsset.findUniqueOrThrow({ where: { id: day1.id } });
    expect(day1After.status).toBe('APPROVED'); // never silently reverted to DRAFT
    expect(day1After.editedCaption).toBe('Human-edited caption'); // never silently discarded
  });

  it('legitimate same-day, different-platform items are both kept, not collapsed as duplicates', async () => {
    const instanceId = await freshInstanceId();
    const items = [
      calendarItem(5, { platform: 'instagram', contentType: 'carousel', caption: 'Instagram day 5' }),
      calendarItem(5, { platform: 'whatsapp', contentType: 'story', caption: 'WhatsApp day 5' }),
    ];
    const handler = getPersistAssetsHandler();
    await handler(ctxWithCalendar(instanceId, items));

    const day5Assets = await prisma.contentAsset.findMany({ where: { workflowInstanceId: instanceId, day: 5 } });
    expect(day5Assets).toHaveLength(2);
    expect(new Set(day5Assets.map((a) => a.platform))).toEqual(new Set(['instagram', 'whatsapp']));
  });

  it('the underlying unique constraint is enforced at the database level, not just application logic', async () => {
    const instanceId = await freshInstanceId();
    await prisma.contentAsset.create({
      data: {
        workspaceId,
        workflowInstanceId: instanceId,
        businessProfileId,
        day: 20,
        platform: 'instagram',
        contentType: 'reel',
        topic: 'x',
        caption: 'x',
        status: 'DRAFT',
      },
    });

    await expect(
      prisma.contentAsset.create({
        data: {
          workspaceId,
          workflowInstanceId: instanceId,
          businessProfileId,
          day: 20,
          platform: 'instagram',
          contentType: 'reel',
          topic: 'y',
          caption: 'y',
          status: 'DRAFT',
        },
      })
    ).rejects.toThrow();
  });
});
