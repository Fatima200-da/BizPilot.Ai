import type { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 29 Section 4: first-party product-event tracking. One flat table
 * (`ProductEvent`), one function to write to it. `eventName` is a plain
 * string column (not a Postgres enum) so this list can grow without a
 * migration — but every call site in THIS codebase goes through the
 * `PRODUCT_EVENTS` union below, so a typo can never silently create a
 * new, uncounted event name from backend code. The client-facing
 * endpoint (`product-event.routes.ts`) enforces the same allowlist at
 * runtime, since a browser request has no compile-time check.
 */
export const PRODUCT_EVENTS = {
  // Acquisition
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_SKIPPED: 'onboarding_skipped',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  // Activation
  FIRST_WORKSPACE_CREATED: 'first_workspace_created',
  FIRST_AI_ACTION: 'first_ai_action',
  FIRST_WORKFLOW_STARTED: 'first_workflow_started',
  FIRST_WORKFLOW_COMPLETED: 'first_workflow_completed',
  FIRST_CONTENT_GENERATED: 'first_content_generated',
  FIRST_CONTENT_APPROVED: 'first_content_approved',
  // Engagement
  DASHBOARD_VIEWED: 'dashboard_viewed',
  WORKFLOW_CREATED: 'workflow_created',
  WORKFLOW_COMPLETED: 'workflow_completed',
  CONTENT_EDITED: 'content_edited',
  CONTENT_APPROVED: 'content_approved',
  NOTIFICATION_OPENED: 'notification_opened',
  // Commercial
  PRICING_VIEWED: 'pricing_viewed',
  UPGRADE_STARTED: 'upgrade_started',
  UPGRADE_COMPLETED: 'upgrade_completed',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  SUBSCRIPTION_REACTIVATED: 'subscription_reactivated',
  // Retention
  SESSION_STARTED: 'session_started',
  WORKSPACE_RETURNED: 'workspace_returned',
} as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS];

/** Client-triggerable subset — pure UI-observation events with no other natural backend hook. Never includes anything business-critical (those are always backend-emitted at the real call site, never trusted from a client claim). */
export const CLIENT_TRACKABLE_EVENTS: ReadonlySet<string> = new Set<ProductEventName>([
  PRODUCT_EVENTS.SIGNUP_STARTED,
  PRODUCT_EVENTS.ONBOARDING_STARTED,
  PRODUCT_EVENTS.DASHBOARD_VIEWED,
  PRODUCT_EVENTS.CONTENT_EDITED,
  PRODUCT_EVENTS.NOTIFICATION_OPENED,
  PRODUCT_EVENTS.PRICING_VIEWED,
  PRODUCT_EVENTS.UPGRADE_STARTED,
  PRODUCT_EVENTS.SESSION_STARTED,
]);

export interface TrackEventInput {
  workspaceId?: string;
  userId?: string;
  eventName: ProductEventName;
  entityType?: string;
  entityId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Fire-and-forget by design: a tracking failure must never break the real
 * business operation it's attached to (e.g. a workflow completing
 * successfully must not roll back or 500 because an analytics insert
 * failed). Errors are logged, never thrown.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    await prisma.productEvent.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        eventName: input.eventName,
        entityType: input.entityType,
        entityId: input.entityId,
        properties: input.properties as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.error('[product-event] trackEvent failed (non-fatal):', input.eventName, err instanceof Error ? err.message : err);
  }
}

/** First occurrence of an event for a workspace, if any — the building block for activation/TTFV metrics. */
export async function getFirstWorkspaceEventAt(workspaceId: string, eventName: ProductEventName): Promise<Date | null> {
  const row = await prisma.productEvent.findFirst({
    where: { workspaceId, eventName },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function hasWorkspaceEvent(workspaceId: string, eventName: ProductEventName): Promise<boolean> {
  const row = await prisma.productEvent.findFirst({ where: { workspaceId, eventName }, select: { id: true } });
  return row !== null;
}

/**
 * Customer-visible activity feed (Section 31 — dashboard shows real
 * activity, never fabricated). A deliberate subset of `PRODUCT_EVENTS`:
 * pure UI telemetry (dashboard_viewed, session_started, notification_opened,
 * pricing_viewed) is real and useful for the activation-metrics engine but
 * means nothing to a business owner glancing at "what happened recently" —
 * only real business moments are shown here. Reuses the already-tracked,
 * already-tenant-scoped `ProductEvent` table rather than the separate,
 * currently-unused `Activity` model, to avoid maintaining two parallel
 * event-recording pathways for the same underlying moments.
 */
const ACTIVITY_FEED_EVENTS: ReadonlySet<string> = new Set<ProductEventName>([
  PRODUCT_EVENTS.ONBOARDING_COMPLETED,
  PRODUCT_EVENTS.FIRST_WORKSPACE_CREATED,
  PRODUCT_EVENTS.FIRST_AI_ACTION,
  PRODUCT_EVENTS.FIRST_WORKFLOW_STARTED,
  PRODUCT_EVENTS.FIRST_WORKFLOW_COMPLETED,
  PRODUCT_EVENTS.FIRST_CONTENT_GENERATED,
  PRODUCT_EVENTS.FIRST_CONTENT_APPROVED,
  PRODUCT_EVENTS.WORKFLOW_CREATED,
  PRODUCT_EVENTS.WORKFLOW_COMPLETED,
  PRODUCT_EVENTS.CONTENT_APPROVED,
  PRODUCT_EVENTS.UPGRADE_COMPLETED,
  PRODUCT_EVENTS.SUBSCRIPTION_CANCELED,
  PRODUCT_EVENTS.SUBSCRIPTION_REACTIVATED,
]);

export interface WorkspaceActivityItem {
  id: string;
  eventName: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

export async function listRecentWorkspaceActivity(workspaceId: string, limit = 10): Promise<WorkspaceActivityItem[]> {
  const rows = await prisma.productEvent.findMany({
    where: { workspaceId, eventName: { in: Array.from(ACTIVITY_FEED_EVENTS) } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, eventName: true, entityType: true, entityId: true, createdAt: true },
  });
  return rows;
}
