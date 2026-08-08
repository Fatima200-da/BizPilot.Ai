import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Fragment, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import type { NavItem } from '@/shared/types/navigation';

export interface SidebarProps {
  items: NavItem[];
  /** Current route path, compared against each item's `href` to derive the active state. */
  activeHref: string;
  logo?: ReactNode;
  /** Rendered pinned to the bottom of the sidebar (e.g. a user menu or plan badge). */
  footer?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Mobile-only drawer visibility, owned by the parent (`DashboardLayout`). */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  className?: string;
}

function isItemActive(item: NavItem, activeHref: string): boolean {
  if (item.href === activeHref) return true;
  return item.href !== '/' && activeHref.startsWith(`${item.href}/`);
}

function NavLinkRow({
  item,
  activeHref,
  collapsed,
  depth = 0,
}: {
  item: NavItem;
  activeHref: string;
  collapsed: boolean;
  depth?: number;
}): JSX.Element {
  const active = isItemActive(item, activeHref);
  const hasChildren = Boolean(item.items?.length);
  const containsActiveChild = item.items?.some((child) => isItemActive(child, activeHref)) ?? false;
  const [expanded, setExpanded] = useState(active || containsActiveChild);

  const row = (
    <a
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
        depth > 0 && 'pl-9',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        collapsed && 'justify-center px-2',
      )}
      onClick={
        hasChildren && !collapsed
          ? (event) => {
              event.preventDefault();
              setExpanded((value) => !value);
            }
          : undefined
      }
    >
      {item.icon ? (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-5"
        >
          {item.icon}
        </span>
      ) : null}
      <span className={cn('flex-1 truncate', collapsed && 'sr-only')}>{item.label}</span>
      {!collapsed && item.badge ? item.badge : null}
      {!collapsed && hasChildren ? (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-180',
          )}
        />
      ) : null}
    </a>
  );

  return (
    <div>
      {row}
      {hasChildren && !collapsed ? (
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-1 flex flex-col gap-1">
                {item.items?.map((child) => (
                  <NavLinkRow
                    key={child.href}
                    item={child}
                    activeHref={activeHref}
                    collapsed={collapsed}
                    depth={depth + 1}
                  />
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </div>
  );
}

function SidebarContent({
  items,
  activeHref,
  logo,
  footer,
  collapsed,
  onCollapsedChange,
  showMobileClose,
  onMobileClose,
}: {
  items: NavItem[];
  activeHref: string;
  logo?: ReactNode;
  footer?: ReactNode;
  collapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  showMobileClose?: boolean;
  onMobileClose?: () => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2 px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className={cn('flex-1 overflow-hidden', collapsed && 'sr-only')}>{logo}</div>
        {showMobileClose ? (
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover lg:hidden"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map((item) => (
          <Fragment key={item.href}>
            <NavLinkRow item={item} activeHref={activeHref} collapsed={collapsed} />
          </Fragment>
        ))}
      </nav>

      {onCollapsedChange ? (
        <button
          type="button"
          onClick={() => {
            onCollapsedChange(!collapsed);
          }}
          className="hidden items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground lg:flex"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          <span className={cn(collapsed && 'sr-only')}>Collapse</span>
        </button>
      ) : null}

      {footer ? (
        <div className={cn('border-t border-border p-3', collapsed && 'px-2')}>{footer}</div>
      ) : null}
    </div>
  );
}

/**
 * Responsive application sidebar: a static collapsible rail on desktop
 * (`lg` and up) and an animated slide-in drawer with backdrop on mobile.
 * Purely presentational - navigation data and active-route detection are
 * supplied by the caller via `items`/`activeHref`.
 */
export function Sidebar({
  items,
  activeHref,
  logo,
  footer,
  collapsed = false,
  onCollapsedChange,
  mobileOpen = false,
  onMobileOpenChange,
  className,
}: SidebarProps): JSX.Element {
  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r border-border transition-[width] duration-200 ease-out lg:block',
          collapsed ? 'w-20' : 'w-64',
          className,
        )}
      >
        <SidebarContent
          items={items}
          activeHref={activeHref}
          logo={logo}
          footer={footer}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
        />
      </aside>

      <AnimatePresence>
        {mobileOpen ? (
          <Fragment>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-neutral-950/50 lg:hidden"
              onClick={() => onMobileOpenChange?.(false)}
              aria-hidden="true"
            />
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border shadow-xl lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <SidebarContent
                items={items}
                activeHref={activeHref}
                logo={logo}
                footer={footer}
                collapsed={false}
                showMobileClose
                onMobileClose={() => onMobileOpenChange?.(false)}
              />
            </motion.div>
          </Fragment>
        ) : null}
      </AnimatePresence>
    </>
  );
}
