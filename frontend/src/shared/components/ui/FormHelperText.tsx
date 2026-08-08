import type { JSX, HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export interface FormHelperTextProps extends HTMLAttributes<HTMLParagraphElement> {
  variant?: 'default' | 'error';
}

/** Helper/error text paired with `Input`, `Textarea`, `Select`, etc. via `aria-describedby`. */
export function FormHelperText({
  className,
  variant = 'default',
  ...props
}: FormHelperTextProps): JSX.Element {
  return (
    <p
      className={cn(
        'text-xs leading-normal',
        variant === 'error' ? 'text-danger' : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
