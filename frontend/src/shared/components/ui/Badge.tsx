import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, JSX } from 'react';
import { cn } from '@/shared/lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-secondary text-secondary-foreground',
        brand:
          'border-transparent bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
        success: 'border-success-border bg-success-surface text-success-foreground',
        warning: 'border-warning-border bg-warning-surface text-warning-foreground',
        danger: 'border-danger-border bg-danger-surface text-danger-foreground',
        info: 'border-info-border bg-info-surface text-info-foreground',
        outline: 'border-border-strong bg-transparent text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Small leading status dot instead of an icon. */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps): JSX.Element {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
