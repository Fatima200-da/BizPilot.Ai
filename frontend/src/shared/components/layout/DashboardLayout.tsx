import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Sidebar } from '@/shared/components/layout/Sidebar';
import { TopNav } from '@/shared/components/layout/TopNav';
import type { TopNavProps } from '@/shared/components/layout/TopNav';
import type { NavItem } from '@/shared/types/navigation';

const COLLAPSE_STORAGE_KEY = 'bizpilot-ai:sidebar-collapsed';

function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return [collapsed, setCollapsed];
}

export interface DashboardLayoutProps {
  navItems: NavItem[];
  activeHref: string;
  logo?: ReactNode;
  sidebarFooter?: ReactNode;
  topNav?: Omit<TopNavProps, 'onMenuClick'>;
  children: ReactNode;
  className?: string;
}

/**
 * Application shell composing `Sidebar` + `TopNav` around a scrollable
 * content area. Owns only presentation state (mobile drawer open/closed,
 * desktop collapsed/expanded) - page data and routing stay with the caller.
 */
export function DashboardLayout({
  navItems,
  activeHref,
  logo,
  sidebarFooter,
  topNav,
  children,
  className,
}: DashboardLayoutProps): JSX.Element {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeHref]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        items={navItems}
        activeHref={activeHref}
        logo={logo}
        footer={sidebarFooter}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          {...topNav}
          onMenuClick={() => {
            setMobileOpen(true);
          }}
        />
        <main className={cn('flex-1 px-4 py-6 sm:px-6 lg:px-8', className)}>{children}</main>
      </div>
    </div>
  );
}
