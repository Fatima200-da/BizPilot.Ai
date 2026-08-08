import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export const alertVariants = cva('relative flex gap-3 rounded-xl border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-info-border bg-info-surface text-info-foreground',
      success: 'border-success-border bg-success-surface text-success-foreground',
      warning: 'border-warning-border bg-warning-surface text-warning-foreground',
      danger: 'border-danger-border bg-danger-surface text-danger-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

const VARIANT_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode;
  /** Renders a close button and fires when it's activated. Omit for a persistent alert. */
  onDismiss?: () => void;
}

export function Alert({
  className,
  variant = 'info',
  title,
  children,
  onDismiss,
  ...props
}: AlertProps): JSX.Element {
  const Icon = VARIANT_ICON[variant ?? 'info'];

  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        {title ? <p className="font-medium leading-5">{title}</p> : null}
        {children ? <div className="leading-5 opacity-90">{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
