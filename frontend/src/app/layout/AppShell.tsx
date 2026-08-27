import type { JSX, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, LayoutDashboard, MessageSquare, ShieldCheck, Sparkles, UserCog, Users } from 'lucide-react';
import { DashboardLayout } from '@/shared/components/layout';
import type { NavItem } from '@/shared/types/navigation';
import { useAuth } from '@/app/providers/AuthProvider';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';

const BASE_NAV_ITEMS: NavItem[] = [
  { label: 'Panel', href: '/', icon: <LayoutDashboard className="size-4" /> },
  { label: 'Marketinq Avtopiloti', href: '/marketing-autopilot', icon: <Sparkles className="size-4" /> },
  { label: 'Müştərilər', href: '/crm', icon: <Users className="size-4" /> },
  { label: 'Komanda', href: '/team', icon: <UserCog className="size-4" /> },
  { label: 'Hesablaşma', href: '/billing', icon: <CreditCard className="size-4" /> },
  { label: 'Rəy bildir', href: '/feedback', icon: <MessageSquare className="size-4" /> },
];

// Phase 27: shown only for `isSystemAdmin` accounts — UX only. Every
// /admin/* request is independently re-authorized server-side regardless
// of whether this link is visible.
const ADMIN_NAV_ITEM: NavItem = { label: 'Admin', href: '/admin', icon: <ShieldCheck className="size-4" /> };

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { auth, logout } = useAuth();
  const navItems = auth?.isSystemAdmin ? [...BASE_NAV_ITEMS, ADMIN_NAV_ITEM] : BASE_NAV_ITEMS;

  return (
    <DashboardLayout
      navItems={navItems}
      activeHref={location.pathname}
      logo={<span className="text-lg font-semibold text-foreground">BizPilot AI</span>}
      topNav={{
        leading: <span className="text-sm font-medium text-foreground">İş sahəsi</span>,
        actions: <NotificationBell />,
        user: auth ? { name: auth.fullName, email: auth.email } : undefined,
        userMenuItems: [
          {
            label: 'Çıxış',
            onSelect: () => {
              logout();
              void navigate('/login');
            },
          },
        ],
      }}
    >
      {children}
    </DashboardLayout>
  );
}
