import type { ContentAsset } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { InvalidStateTransitionError, NotFoundError } from '../../common/errors/app-error';
import { paginate, type Page } from '../../common/utils/pagination';
import type { ListContentAssetsQuery, UpdateContentAssetInput } from './content-asset.validation';
import { trackEvent, hasWorkspaceEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

/** Phase 15 Section 7's explicit lifecycle. SCHEDULED/PUBLISHED are reachable only by a future real integration, never this endpoint (Section 26). */
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW', 'APPROVED'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['IN_REVIEW'], // an approval can be walked back before anything downstream has happened
  SCHEDULED: [],
  PUBLISHED: [],
};

export async function listContentAssets(workspaceId: string, opts: ListContentAssetsQuery): Promise<Page<ContentAsset>> {
  const where = {
    workspaceId,
    ...(opts.workflowInstanceId ? { workflowInstanceId: opts.workflowInstanceId } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };
  const rows = await prisma.contentAsset.findMany({
    where,
    orderBy: [{ workflowInstanceId: 'asc' }, { day: 'asc' }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  return paginate(rows, opts.limit);
}

export async function getContentAsset(workspaceId: string, id: string): Promise<ContentAsset> {
  const asset = await prisma.contentAsset.findFirst({ where: { id, workspaceId } });
  if (!asset) throw new NotFoundError();
  return asset;
}

export async function updateContentAsset(
  workspaceId: string,
  id: string,
  userId: string,
  input: UpdateContentAssetInput
): Promise<ContentAsset> {
  const existing = await getContentAsset(workspaceId, id);

  if (input.status && input.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new InvalidStateTransitionError(
        `Content asset cannot transition from ${existing.status} to ${input.status}. Valid next states: ${allowed.join(', ') || 'none'}.`
      );
    }
  }

  const updated = await prisma.contentAsset.update({
    where: { id },
    data: {
      ...(input.editedCaption !== undefined ? { editedCaption: input.editedCaption } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.status === 'APPROVED' ? { approvedByUserId: userId, approvedAt: new Date() } : {}),
    },
  });

  if (input.status === 'APPROVED' && existing.status !== 'APPROVED') {
    const isFirst = !(await hasWorkspaceEvent(workspaceId, PRODUCT_EVENTS.FIRST_CONTENT_APPROVED));
    await trackEvent({ workspaceId, userId, eventName: PRODUCT_EVENTS.CONTENT_APPROVED, entityType: 'ContentAsset', entityId: id });
    if (isFirst) {
      await trackEvent({ workspaceId, userId, eventName: PRODUCT_EVENTS.FIRST_CONTENT_APPROVED, entityType: 'ContentAsset', entityId: id });
    }
  }

  return updated;
}
