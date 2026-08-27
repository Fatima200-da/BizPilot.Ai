import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dropdown, DropdownContent, DropdownTrigger } from '@/shared/components/overlay/Dropdown';
import { SkeletonText } from '@/shared/components/feedback/Skeleton';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '@/features/notifications/api/notifications.api';
import { getNotificationIcon, getNotificationTone, formatRelativeTime } from '@/features/notifications/lib/notification-display';
import { cn } from '@/shared/lib/cn';

const TONE_CLASSES: Record<ReturnType<typeof getNotificationTone>, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  success: 'bg-success-surface text-success-foreground',
  warning: 'bg-warning-surface text-warning-foreground',
  danger: 'bg-danger-surface text-danger-foreground',
};

function NotificationRow({ notification, onRead }: { notification: AppNotification; onRead: (id: string) => void }): JSX.Element {
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
        'flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left text-sm outline-none transition-colors hover:bg-surface-hover',
        isUnread && 'bg-brand-50/50 dark:bg-brand-500/5',
      )}
    >
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[getNotificationTone(notification.type)])}>
        {getNotificationIcon(notification.type, 'size-3.5')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cn('line-clamp-2 text-foreground', isUnread ? 'font-medium' : 'font-normal')}>{notification.title}</span>
          {isUnread ? <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-500" /> : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</span>
      </span>
    </button>
  );
}

/** Header bell: unread badge, dropdown preview of the most recent notifications, "mark all read", link to the full page. Polls for the unread count so the badge stays live without WebSocket/SSE infrastructure — the underlying API (`GET /notifications`) is shaped so that upgrade is additive, not a breaking change. */
export function NotificationBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });

  const { data: preview, isLoading, isError } = useQuery({
    queryKey: ['notifications', 'preview'],
    queryFn: () => listNotifications({ limit: 6 }),
    enabled: open,
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

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label={unreadCount > 0 ? `Notifications, ${String(unreadCount)} unread` : 'Notifications'}
        className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-danger-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </DropdownTrigger>
      <DropdownContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto p-1.5">
          {isLoading ? (
            <div className="space-y-3 px-2.5 py-3">
              <SkeletonText lines={2} />
              <SkeletonText lines={2} />
            </div>
          ) : isError ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">Couldn't load notifications.</p>
          ) : preview && preview.items.length > 0 ? (
            preview.items.map((n) => <NotificationRow key={n.id} notification={n} onRead={handleMarkRead} />)
          ) : (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void navigate('/notifications');
          }}
          className="block w-full border-t border-border px-3 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-surface-hover dark:text-brand-400"
        >
          View all notifications
        </button>
      </DropdownContent>
    </Dropdown>
  );
}
