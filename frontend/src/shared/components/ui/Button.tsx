import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/shared/lib/cn';
import { Spinner } from '@/shared/components/ui/Spinner';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium',
    'rounded-md transition-colors duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:brightness-95',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-secondary-hover',
        outline:
          'border border-border-strong bg-transparent text-foreground hover:bg-surface-hover',
        ghost: 'bg-transparent text-foreground hover:bg-surface-hover',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover',
        link: 'text-primary underline-offset-4 hover:underline p-0 h-auto rounded-none',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a router `Link`) with button styles/behavior instead of a `<button>`. */
  asChild?: boolean;
  /** Shows a spinner and disables the button, preserving its width. */
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref,
  ): JSX.Element => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled ?? isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? <Spinner size={size === 'lg' ? 'lg' : 'sm'} label="" /> : leftIcon}
        {children}
        {!isLoading ? rightIcon : null}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
