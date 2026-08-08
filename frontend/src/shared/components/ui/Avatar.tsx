import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { JSX } from 'react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-medium text-secondary-foreground select-none',
  {
    variants: {
      size: {
        xs: 'size-6 text-[10px]',
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-12 text-base',
        xl: 'size-16 text-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  src?: string;
  /** Full name used to derive initials and the `alt` text. */
  name: string;
  className?: string;
  /** Renders a small colored ring, e.g. to signal online presence. */
  statusColor?: 'success' | 'warning' | 'danger' | 'neutral';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const STATUS_COLOR_MAP = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-neutral-400',
} as const;

/** Displays a user image, falling back to initials if the image is missing or fails to load. */
export function Avatar({ src, name, size, className, statusColor }: AvatarProps): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;

  return (
    <span className={cn(avatarVariants({ size }), className)}>
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : (
        <span aria-hidden="true">{getInitials(name)}</span>
      )}
      {statusColor ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-0 right-0 size-[28%] rounded-full ring-2 ring-surface',
            STATUS_COLOR_MAP[statusColor],
          )}
        />
      ) : null}
    </span>
  );
}
