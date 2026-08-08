import type { HTMLAttributes, JSX } from 'react';
import { cn } from '@/shared/lib/cn';

/** Base shimmering placeholder block. Compose with utility classes for shape (`h-4 w-32`, `rounded-full`, ...). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(110deg,var(--color-surface-secondary)_35%,var(--color-surface-hover)_50%,var(--color-surface-secondary)_65%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

/** Stack of skeleton lines that mimics paragraph text, with the last line shortened. */
export function SkeletonText({ lines = 3, className, ...props }: SkeletonTextProps): JSX.Element {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export interface SkeletonAvatarProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const AVATAR_SIZE = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;

export function SkeletonAvatar({
  size = 'md',
  className,
  ...props
}: SkeletonAvatarProps): JSX.Element {
  return <Skeleton className={cn('rounded-full', AVATAR_SIZE[size], className)} {...props} />;
}

/** Placeholder matching the default `Card` shape (avatar + title + two text lines). */
export function SkeletonCard({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('space-y-4 rounded-xl border border-border bg-surface p-6', className)}
      {...props}
    >
      <div className="flex items-center gap-3">
        <SkeletonAvatar />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}
