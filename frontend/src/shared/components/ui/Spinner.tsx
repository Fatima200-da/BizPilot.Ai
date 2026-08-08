import type { JSX } from 'react';
import { cn } from '@/shared/lib/cn';

const SIZE_MAP = {
  sm: 'size-3.5 border-[1.5px]',
  md: 'size-4 border-2',
  lg: 'size-5 border-2',
  xl: 'size-8 border-[3px]',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE_MAP;
  className?: string;
  /** Accessible label announced to screen readers while the spinner is visible. */
  label?: string;
}

/** Indeterminate loading indicator. Used standalone or inside `Button`/`Skeleton`. */
export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps): JSX.Element {
  return (
    <span role="status" className={cn('inline-flex', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'animate-spin rounded-full border-current border-t-transparent text-current opacity-80',
          SIZE_MAP[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
