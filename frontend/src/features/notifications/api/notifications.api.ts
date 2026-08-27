import { apiClient } from '@/shared/lib/api-client';

export type NotificationType =
  | 'WELCOME'
  | 'ONBOARDING_REMINDER'
  | 'INVITATION_RECEIVED'
  | 'INVITATION_ACCEPTED'
  | 'SUBSCRIPTION_CHANGED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_REACTIVATED'
  | 'PLAN_LIMIT_WARNING'
  | 'CREDITS_LOW'
  | 'CREDITS_EXHAUSTED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED'
  | 'WORKFLOW_RETRYING'
  | 'SCHEDULED_WORKFLOW_COMPLETED'
  | 'APPROVAL_REQUIRED'
  | 'SECURITY_EVENT'
  | 'PAYMENT_FAILED';

export interface AppNotification {
  id: string;
  workspaceId: string | null;
  recipientUserId: string;
  category: string;
  type: NotificationType;
  title: string;
  body: string | null;
  linkUrl: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ListNotificationsResult {
  items: AppNotification[];
  nextCursor: string | null;
}

export async function listNotifications(params: { cursor?: string; limit?: number } = {}): Promise<ListNotificationsResult> {
  const { data } = await apiClient.get<{ data: ListNotificationsResult }>('/notifications', { params });
  return data.data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<{ data: { count: number } }>('/notifications/unread-count');
  return data.data.count;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const { data } = await apiClient.patch<{ data: AppNotification }>(`/notifications/${id}/read`);
  return data.data;
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const { data } = await apiClient.patch<{ data: { updated: number } }>('/notifications/read-all');
  return data.data;
}
