import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef, JSX } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/shared/lib/cn';

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = forwardRef<
  ComponentRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref): JSX.Element => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'fixed bottom-0 right-0 z-100 flex w-full max-w-sm flex-col gap-2.5 p-4 outline-none sm:bottom-4 sm:right-4',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

export const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-foreground',
        success:
          'border-success-border bg-surface text-foreground [&_[data-toast-icon]]:text-success',
        warning:
          'border-warning-border bg-surface text-foreground [&_[data-toast-icon]]:text-warning',
        danger: 'border-danger-border bg-surface text-foreground [&_[data-toast-icon]]:text-danger',
        info: 'border-info-border bg-surface text-foreground [&_[data-toast-icon]]:text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type ToastRootProps = ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
  VariantProps<typeof toastVariants>;

export const ToastRoot = forwardRef<ComponentRef<typeof ToastPrimitive.Root>, ToastRootProps>(
  ({ className, variant, ...props }, ref): JSX.Element => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(
        toastVariants({ variant }),
        'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
        'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
        'data-[swipe=end]:animate-slide-out-right',
        className,
      )}
      {...props}
    />
  ),
);
ToastRoot.displayName = 'ToastRoot';

export const ToastTitle = forwardRef<
  ComponentRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref): JSX.Element => (
  <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
));
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = forwardRef<
  ComponentRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref): JSX.Element => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('mt-0.5 text-sm text-muted-foreground', className)}
    {...props}
  />
));
ToastDescription.displayName = 'ToastDescription';

export const ToastAction = forwardRef<
  ComponentRef<typeof ToastPrimitive.Action>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref): JSX.Element => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      'shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = 'ToastAction';

export const ToastClose = forwardRef<
  ComponentRef<typeof ToastPrimitive.Close>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref): JSX.Element => (
  <ToastPrimitive.Close
    ref={ref}
    aria-label="Dismiss notification"
    className={cn(
      'absolute right-2.5 top-2.5 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity',
      'group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  >
    <X className="size-3.5" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = 'ToastClose';
