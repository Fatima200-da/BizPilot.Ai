import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from '@/shared/components/feedback/Toast';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. Defaults to 5000; pass `Infinity` to require manual dismissal. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastEntry extends ToastOptions {
  id: string;
}

let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

function pushToast(options: ToastOptions): string {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, duration: 5000, variant: 'default', ...options }];
  notify();
  return id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastEntry[] {
  return toasts;
}

/**
 * Imperative toast API - callable from anywhere (components, query error
 * handlers, event listeners), not just inside React. Render `<Toaster />`
 * once near the app root to display what gets pushed here.
 */
export const toast = {
  show: (options: ToastOptions): string => pushToast(options),
  success: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>): string =>
    pushToast({ ...options, title, variant: 'success' }),
  danger: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>): string =>
    pushToast({ ...options, title, variant: 'danger' }),
  warning: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>): string =>
    pushToast({ ...options, title, variant: 'warning' }),
  info: (title: ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>): string =>
    pushToast({ ...options, title, variant: 'info' }),
  dismiss: dismissToast,
};

const VARIANT_ICON: Record<Exclude<ToastVariant, 'default'>, typeof Info> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/** Hook form of the toast store, for components that want to re-render on toast changes. */
export function useToasts(): ToastEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Renders the toast stack. Mount once near the app root (inside `app/providers`). */
export function Toaster(): JSX.Element {
  const activeToasts = useToasts();

  return (
    <ToastProvider swipeDirection="right">
      {activeToasts.map(({ id, title, description, variant = 'default', duration, action }) => {
        const Icon = variant === 'default' ? null : VARIANT_ICON[variant];
        return (
          <ToastRoot
            key={id}
            variant={variant}
            duration={duration === Infinity ? undefined : duration}
            onOpenChange={(open) => {
              if (!open) dismissToast(id);
            }}
          >
            {Icon ? (
              <Icon data-toast-icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="flex-1">
              {title ? <ToastTitle>{title}</ToastTitle> : null}
              {description ? <ToastDescription>{description}</ToastDescription> : null}
            </div>
            {action ? (
              <ToastAction altText={action.label} onClick={action.onClick}>
                {action.label}
              </ToastAction>
            ) : null}
            <ToastClose />
          </ToastRoot>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
