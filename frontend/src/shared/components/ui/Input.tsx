import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { InputHTMLAttributes, JSX, ReactNode } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '@/shared/lib/cn';

export const inputVariants = cva(
  [
    'w-full rounded-md border bg-surface text-foreground transition-colors duration-150',
    'placeholder:text-muted-foreground',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-secondary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
  ],
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5 text-sm',
        md: 'h-10 px-3 text-sm',
        lg: 'h-12 px-4 text-base',
      },
      hasLeftIcon: { true: '', false: '' },
      hasRightIcon: { true: '', false: '' },
    },
    compoundVariants: [
      { size: 'sm', hasLeftIcon: true, className: 'pl-8' },
      { size: 'md', hasLeftIcon: true, className: 'pl-9' },
      { size: 'lg', hasLeftIcon: true, className: 'pl-11' },
      { size: 'sm', hasRightIcon: true, className: 'pr-8' },
      { size: 'md', hasRightIcon: true, className: 'pr-9' },
      { size: 'lg', hasRightIcon: true, className: 'pr-11' },
    ],
    defaultVariants: {
      size: 'md',
      hasLeftIcon: false,
      hasRightIcon: false,
    },
  },
);

const ICON_WRAPPER_SIZE = { sm: 'size-8', md: 'size-9', lg: 'size-11' } as const;

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, VariantProps<typeof inputVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  invalid?: boolean;
  /** Id of a `FormHelperText`/error node; merged with any caller-provided `aria-describedby`. */
  describedBy?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { className, size = 'md', leftIcon, rightIcon, invalid, describedBy, id, ...props },
    ref,
  ): JSX.Element => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const resolvedSize = size ?? 'md';

    return (
      <div className="relative">
        {leftIcon ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute left-0 top-0 inline-flex items-center justify-center text-muted-foreground [&>svg]:size-4',
              ICON_WRAPPER_SIZE[resolvedSize],
            )}
          >
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            inputVariants({
              size: resolvedSize,
              hasLeftIcon: Boolean(leftIcon),
              hasRightIcon: Boolean(rightIcon),
            }),
            className,
          )}
          {...props}
        />
        {rightIcon ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute right-0 top-0 inline-flex items-center justify-center text-muted-foreground [&>svg]:size-4',
              ICON_WRAPPER_SIZE[resolvedSize],
            )}
          >
            {rightIcon}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
