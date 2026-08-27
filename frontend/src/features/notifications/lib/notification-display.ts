import type { JSX } from 'react';
import { createElement } from 'react';
import {
  PartyPopper,
  UserPlus,
  UserCheck,
  CreditCard,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Zap,
  ZapOff,
  CheckCircle2,
  XOctagon,
  ShieldAlert,
  Bell,
  RefreshCw,
  CalendarCheck,
  CircleDollarSign,
} from 'lucide-react';
import type { NotificationType } from '@/features/notifications/api/notifications.api';

const ICONS: Partial<Record<NotificationType, (props: { className?: string }) => JSX.Element>> = {
  WELCOME: (p) => createElement(PartyPopper, p),
  ONBOARDING_REMINDER: (p) => createElement(Bell, p),
  INVITATION_RECEIVED: (p) => createElement(UserPlus, p),
  INVITATION_ACCEPTED: (p) => createElement(UserCheck, p),
  SUBSCRIPTION_CHANGED: (p) => createElement(CreditCard, p),
  SUBSCRIPTION_CANCELED: (p) => createElement(XCircle, p),
  SUBSCRIPTION_REACTIVATED: (p) => createElement(RotateCcw, p),
  PLAN_LIMIT_WARNING: (p) => createElement(AlertTriangle, p),
  CREDITS_LOW: (p) => createElement(Zap, p),
  CREDITS_EXHAUSTED: (p) => createElement(ZapOff, p),
  WORKFLOW_COMPLETED: (p) => createElement(CheckCircle2, p),
  WORKFLOW_FAILED: (p) => createElement(XOctagon, p),
  WORKFLOW_RETRYING: (p) => createElement(RefreshCw, p),
  SCHEDULED_WORKFLOW_COMPLETED: (p) => createElement(CalendarCheck, p),
  APPROVAL_REQUIRED: (p) => createElement(AlertTriangle, p),
  SECURITY_EVENT: (p) => createElement(ShieldAlert, p),
  PAYMENT_FAILED: (p) => createElement(CircleDollarSign, p),
};

export function getNotificationIcon(type: NotificationType, className = 'size-4'): JSX.Element {
  const Icon = ICONS[type] ?? (() => createElement(Bell, { className }));
  return Icon({ className });
}

/** Coarse tone used for the icon container's color — not a full design system, just enough to distinguish "bad news" from "good news" at a glance. */
export function getNotificationTone(type: NotificationType): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (type) {
    case 'WORKFLOW_FAILED':
    case 'CREDITS_EXHAUSTED':
    case 'SUBSCRIPTION_CANCELED':
    case 'SECURITY_EVENT':
    case 'PAYMENT_FAILED':
      return 'danger';
    case 'PLAN_LIMIT_WARNING':
    case 'CREDITS_LOW':
    case 'APPROVAL_REQUIRED':
    case 'WORKFLOW_RETRYING':
      return 'warning';
    case 'WORKFLOW_COMPLETED':
    case 'WELCOME':
    case 'INVITATION_ACCEPTED':
    case 'SUBSCRIPTION_REACTIVATED':
    case 'SCHEDULED_WORKFLOW_COMPLETED':
      return 'success';
    default:
      return 'neutral';
  }
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** No date-formatting library in this codebase yet — a small, dependency-free relative-time helper is enough for notification timestamps. */
export function formatRelativeTime(iso: string): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) return 'just now';

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (absSeconds >= secondsInUnit) {
      return relativeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
}
