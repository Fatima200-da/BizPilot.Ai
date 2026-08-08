import { Menu, Search } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Input } from '@/shared/components/ui/Input';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/shared/components/overlay/Dropdown';

export interface TopNavUser {
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface TopNavUserMenuItem {
  label: string;
  onSelect: () => void;
  variant?: 'default' | 'danger';
}

export interface TopNavProps {
  /** Toggles the mobile `Sidebar` drawer; hidden when omitted. */
  onMenuClick?: () => void;
  /** Slot rendered left-aligned after the menu button (e.g. breadcrumbs, page title). */
  leading?: ReactNode;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  /** Slot for icon buttons: notifications, theme toggle, help, etc. */
  actions?: ReactNode;
  user?: TopNavUser;
  userMenuItems?: TopNavUserMenuItem[];
  className?: string;
}

/** Sticky top bar: mobile menu trigger, page context, search, actions, and the user menu. */
export function TopNav({
  onMenuClick,
  leading,
  searchPlaceholder,
  onSearchChange,
  actions,
  user,
  userMenuItems,
  className,
}: TopNavProps): JSX.Element {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md sm:px-6',
        className,
      )}
    >
      {onMenuClick ? (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>
      ) : null}

      {leading ? <div className="min-w-0 flex-1">{leading}</div> : <div className="flex-1" />}

      {searchPlaceholder ? (
        <div className="hidden w-full max-w-xs sm:block">
          <Input
            type="search"
            size="sm"
            placeholder={searchPlaceholder}
            leftIcon={<Search />}
            onChange={(event) => onSearchChange?.(event.target.value)}
            aria-label="Search"
          />
        </div>
      ) : null}

      {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}

      {user ? (
        <Dropdown>
          <DropdownTrigger
            className="ml-1 flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`Account menu for ${user.name}`}
          >
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{user.name}</span>
              {user.email ? (
                <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
              ) : null}
            </DropdownLabel>
            {userMenuItems?.length ? <DropdownSeparator /> : null}
            {userMenuItems?.map((item) => (
              <DropdownItem key={item.label} variant={item.variant} onSelect={item.onSelect}>
                {item.label}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
      ) : null}
    </header>
  );
}
