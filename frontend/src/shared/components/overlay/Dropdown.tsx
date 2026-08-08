import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef, HTMLAttributes, JSX } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/shared/lib/cn';

export const Dropdown = DropdownMenuPrimitive.Root;
export const DropdownTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownGroup = DropdownMenuPrimitive.Group;
export const DropdownRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownSub = DropdownMenuPrimitive.Sub;

const contentClassName = cn(
  'z-100 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg',
  'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
  'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
);

export const DropdownContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(contentClassName, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownContent.displayName = 'DropdownContent';

export const DropdownSubContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(contentClassName, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownSubContent.displayName = 'DropdownSubContent';

const itemClassName = cn(
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none',
  'data-[highlighted]:bg-surface-hover',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
);

export interface DropdownItemProps extends ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> {
  variant?: 'default' | 'danger';
}

export const DropdownItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownItemProps
>(({ className, variant = 'default', ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      itemClassName,
      variant === 'danger' && 'text-danger data-[highlighted]:bg-danger-surface',
      className,
    )}
    {...props}
  />
));
DropdownItem.displayName = 'DropdownItem';

export const DropdownCheckboxItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(itemClassName, 'pl-8', className)}
    {...props}
  >
    <span className="absolute left-2.5 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-3.5" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownCheckboxItem.displayName = 'DropdownCheckboxItem';

export const DropdownRadioItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(itemClassName, 'pl-8', className)}
    {...props}
  >
    <span className="absolute left-2.5 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="size-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownRadioItem.displayName = 'DropdownRadioItem';

export const DropdownSubTrigger = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.SubTrigger ref={ref} className={cn(itemClassName, className)} {...props}>
    {children}
    <ChevronRight className="ml-auto size-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownSubTrigger.displayName = 'DropdownSubTrigger';

export const DropdownLabel = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-xs font-medium text-muted-foreground', className)}
    {...props}
  />
));
DropdownLabel.displayName = 'DropdownLabel';

export const DropdownSeparator = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref): JSX.Element => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-border', className)}
    {...props}
  />
));
DropdownSeparator.displayName = 'DropdownSeparator';

export function DropdownShortcut({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}
