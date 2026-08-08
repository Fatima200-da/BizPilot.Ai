import type { JSX, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Primary and, optionally, secondary call-to-action rendered below the copy (e.g. `Button` elements). */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

/** Centered placeholder for empty lists/tables/search results. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-strong px-6 py-16 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground [&>svg]:size-6">
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-2 flex items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
