import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui';
import { EmptyState, Alert, SkeletonText } from '@/shared/components/feedback';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '@/features/notifications/api/notifications.api';
import { getNotificationIcon, getNotificationTone, formatRelativeTime } from '@/features/notifications/lib/notification-display';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/lib/cn';

const TONE_CLASSES: Record<ReturnType<typeof getNotificationTone>, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  success: 'bg-success-surface text-success-foreground',
  warning: 'bg-warning-surface text-warning-foreground',
  danger: 'bg-danger-surface text-danger-foreground',
};

function NotificationListItem({ notification, onRead }: { notification: AppNotification; onRead: (id: string) => void }): JSX.Element {
  const navigate = useNavigate();
  const isUnread = notification.readAt === null;

  return (
    <button
      type="button"
      onClick={() => {
        if (isUnread) onRead(notification.id);
        if (notification.linkUrl) void navigate(notification.linkUrl);
      }}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-surface-hover',
        isUnread && 'bg-brand-50/40 dark:bg-brand-500/5',
      )}
    >
      <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[getNotificationTone(notification.type)])}>
        {getNotificationIcon(notification.type, 'size-4')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className={cn('text-sm text-foreground', isUnread ? 'font-semibold' : 'font-medium')}>{notification.title}</span>
          {isUnread ? <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" /> : null}
        </span>
        {notification.body ? <span className="mt-0.5 block text-sm text-muted-foreground">{notification.body}</span> : null}
        <span className="mt-1 block text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</span>
      </span>
    </button>
  );
}

/** Phase 27 Section 8-9: the full notification center — pagination (cursor-based "load more", matching the API's own cursor shape rather than inventing page numbers), mark-as-read, mark-all-read, and explicit empty/loading/error states. */
export function NotificationsPage(): JSX.Element {
  useDocumentTitle('Notifications');
  const queryClient = useQueryClient();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notifications', 'list', cursor],
    queryFn: () => listNotifications({ cursor, limit: 20 }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handleMarkRead = (id: string): void => {
    void markNotificationRead(id).then(invalidate);
  };

  const handleMarkAllRead = (): void => {
    void markAllNotificationsRead().then(invalidate);
  };

  const hasUnread = data?.items.some((n) => n.readAt === null) ?? false;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Notifications</CardTitle>
          {hasUnread ? (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4 py-2">
              <SkeletonText lines={2} />
              <SkeletonText lines={2} />
              <SkeletonText lines={2} />
            </div>
          ) : isError ? (
            <Alert variant="danger">{getApiErrorMessage(error)}</Alert>
          ) : data && data.items.length > 0 ? (
            <>
              <div className="flex flex-col gap-1">
                {data.items.map((n) => (
                  <NotificationListItem key={n.id} notification={n} onRead={handleMarkRead} />
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cursors.length <= 1}
                  onClick={() => {
                    setCursors((prev) => prev.slice(0, -1));
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    if (data.nextCursor) setCursors((prev) => [...prev, data.nextCursor ?? undefined]);
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon={<Bell />} title="No notifications yet" description="Workflow updates, team activity, and billing alerts will show up here." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
