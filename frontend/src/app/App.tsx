import type { JSX } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { Toaster } from '@/shared/components/feedback';
import { RequireAuth, RequireWorkspace } from '@/app/router/RequireAuth';
import { AppShell } from '@/app/layout/AppShell';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { RegisterPage } from '@/features/auth/pages/RegisterPage';
import { OnboardingPage } from '@/features/onboarding/pages/OnboardingPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { MarketingAutopilotPage } from '@/features/marketing-autopilot/pages/MarketingAutopilotPage';
import { CrmPage } from '@/features/crm/pages/CrmPage';
import { BillingPage } from '@/features/billing/pages/BillingPage';
import { TeamPage } from '@/features/team/pages/TeamPage';
import { NotificationsPage } from '@/features/notifications/pages/NotificationsPage';
import { AdminPage } from '@/features/admin/pages/AdminPage';
import { FeedbackPage } from '@/features/feedback/pages/FeedbackPage';
import { NotFoundPage } from '@/app/NotFoundPage';

export function App(): JSX.Element {
  return (
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<RequireAuth />}>
              <Route path="/onboarding" element={<OnboardingPage />} />

              <Route element={<RequireWorkspace />}>
                <Route
                  path="/"
                  element={
                    <AppShell>
                      <DashboardPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/marketing-autopilot"
                  element={
                    <AppShell>
                      <MarketingAutopilotPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/crm"
                  element={
                    <AppShell>
                      <CrmPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/billing"
                  element={
                    <AppShell>
                      <BillingPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/team"
                  element={
                    <AppShell>
                      <TeamPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    <AppShell>
                      <NotificationsPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/feedback"
                  element={
                    <AppShell>
                      <FeedbackPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <AppShell>
                      <AdminPage />
                    </AppShell>
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryProvider>
  );
}
