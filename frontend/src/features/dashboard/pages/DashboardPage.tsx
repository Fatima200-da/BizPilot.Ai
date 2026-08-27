import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles, Users, Building2, Activity as ActivityIcon, TriangleAlert } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui';
import { EmptyState, Skeleton, Alert } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { listBusinessProfiles } from '@/features/onboarding/api/onboarding.api';
import { listRecentActivity, type WorkspaceActivityItem } from '@/features/dashboard/api/activity.api';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { getUsage } from '@/features/billing/api/billing.api';
import { getCreditLifecycleState } from '@/features/billing/lib/credit-lifecycle';

const ACTIVITY_LABEL: Record<string, string> = {
  onboarding_completed: 'Qeydiyyatı tamamladınız',
  first_workspace_created: 'İş sahəniz yaradıldı',
  first_ai_action: 'İlk AI əməliyyatınızı etdiniz',
  first_workflow_started: 'İlk avtomatlaşdırmanız başladı',
  first_workflow_completed: 'İlk avtomatlaşdırmanız tamamlandı',
  first_content_generated: 'İlk məzmununuz yaradıldı',
  first_content_approved: 'İlk məzmununuzu təsdiqlədiniz',
  workflow_created: 'Yeni avtomatlaşdırma başladıldı',
  workflow_completed: 'Avtomatlaşdırma tamamlandı',
  content_approved: 'Məzmun təsdiqləndi',
  upgrade_completed: 'Planınız yüksəldildi',
  subscription_canceled: 'Abunəlik ləğv edildi',
  subscription_reactivated: 'Abunəlik yenidən aktivləşdirildi',
};

function formatTimeOnly(date: Date): string {
  return date.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(date: Date): string {
  // 'az-AZ' short month names are not reliably supported by browser ICU
  // data (observed rendering as a raw "M08" token) — numeric day.month
  // sidesteps that gap entirely rather than depending on it.
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface ActivityGroup {
  label: string;
  items: WorkspaceActivityItem[];
}

/** Phase 30 Track G.14: a real "Today / Yesterday / <date>" grouped timeline — the same items Phase 29's flat list already fetched, just bucketed by real local calendar day, newest group first (the API already returns items newest-first, so grouping preserves that order). */
function groupActivityByDay(items: WorkspaceActivityItem[]): ActivityGroup[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: ActivityGroup[] = [];
  for (const item of items) {
    const itemDate = new Date(item.createdAt);
    const label = isSameLocalDay(itemDate, now) ? 'Bugün' : isSameLocalDay(itemDate, yesterday) ? 'Dünən' : formatDateOnly(itemDate);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

/**
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 20.2: only real data is
 * shown here — no fabricated analytics. Business Health / Recommendations
 * widgets (Part 11's Business Analyzer) are a later horizon, not faked here.
 */
export function DashboardPage(): JSX.Element {
  useDocumentTitle('Panel');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';

  const { data: businessProfiles, isLoading } = useQuery({
    queryKey: ['business-profiles', workspaceId],
    queryFn: () => listBusinessProfiles(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const primaryProfile = businessProfiles?.[0];

  const { data: activity, isLoading: isActivityLoading } = useQuery({
    queryKey: ['dashboard-activity', workspaceId],
    queryFn: () => listRecentActivity(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // Phase 34 Track D: "what needs my attention?" — the dashboard previously
  // answered "what happened" (activity feed) but nothing about what's
  // urgent right now. Reuses the exact real usage data and lifecycle
  // thresholds already computed for the Billing page (credit-lifecycle.ts)
  // rather than a new, decorative metric — this only renders when the
  // real, already-alerting-eligible LOW/CRITICAL/EXHAUSTED state is true.
  const { data: usage } = useQuery({
    queryKey: ['usage-summary', workspaceId],
    queryFn: () => getUsage(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const creditState = usage ? getCreditLifecycleState(usage.aiCredits.balance, usage.aiCredits.monthlyAllowance) : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Xoş gəlmisiniz, {auth?.fullName}</h1>
        <p className="text-sm text-muted-foreground">BizPilot AI biznesinizi anlayır və işinizi görməyə hazırdır.</p>
      </div>

      {creditState === 'LOW' || creditState === 'CRITICAL' || creditState === 'EXHAUSTED' ? (
        <Alert variant={creditState === 'LOW' ? 'warning' : 'danger'}>
          <TriangleAlert className="size-5 shrink-0" />
          <div className="flex flex-1 items-center justify-between gap-4">
            <span>
              {creditState === 'EXHAUSTED'
                ? 'AI kreditləriniz tükənib. Yeni məzmun yarada bilməzsiniz.'
                : creditState === 'CRITICAL'
                  ? 'AI kreditləriniz demək olar ki, tükənib.'
                  : 'AI kreditləriniz azalır.'}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to="/billing">Planı yüksəldin</Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      {isLoading ? null : primaryProfile ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              {primaryProfile.name}
            </CardTitle>
            <CardDescription>{primaryProfile.industry ?? 'Sahə göstərilməyib'}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <EmptyState
          title="Biznes profili tapılmadı"
          description="Biznesinizi təsvir edərək başlayın."
          action={<Button asChild><Link to="/onboarding">Biznesinizi təsvir edin</Link></Button>}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-brand-500" />
              Marketinq Avtopiloti
            </CardTitle>
            <CardDescription>30 günlük məzmun planı yaradın — strategiya, sütunlar, təqvim.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/marketing-autopilot">Plan yarat</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 text-brand-500" />
              Müştərilər (CRM)
            </CardTitle>
            <CardDescription>Əlaqələrinizi və satış imkanlarınızı idarə edin.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/crm">Müştəriləri gör</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="size-5" />
            Son fəaliyyət
          </CardTitle>
          <CardDescription>İş sahənizdə baş verən əsas hadisələr.</CardDescription>
        </CardHeader>
        <CardContent>
          {isActivityLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !activity || activity.length === 0 ? (
            <EmptyState title="Hələ fəaliyyət yoxdur" description="İlk avtomatlaşdırmanızı işə saldıqda burada görünəcək." />
          ) : (
            <div className="flex flex-col gap-4">
              {groupActivityByDay(activity).map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 text-sm">
                        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTimeOnly(new Date(item.createdAt))}</span>
                        <span className="text-foreground">{ACTIVITY_LABEL[item.eventName] ?? item.eventName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
