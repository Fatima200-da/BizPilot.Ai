import type { JSX } from 'react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui';
import { EmptyState, Alert, Skeleton } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import {
  cancelSubscription,
  downgradePlan,
  getSubscription,
  getUsage,
  listInvoices,
  listPlans,
  reactivateSubscription,
  upgradePlan,
  type Plan,
  type Subscription,
  type UsageMetric,
} from '@/features/billing/api/billing.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { getCreditLifecycleState, CREDIT_LIFECYCLE_COPY } from '@/features/billing/lib/credit-lifecycle';

function formatCents(cents: number | null): string {
  if (cents === null) return 'Contact us';
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(0)}/mo`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const STATUS_BADGE: Record<Subscription['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  TRIALING: { label: 'Trial', variant: 'info' },
  PAST_DUE: { label: 'Past due', variant: 'warning' },
  CANCELED: { label: 'Canceled', variant: 'danger' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  PAUSED: { label: 'Paused', variant: 'neutral' },
};

function UsageBar({ label, metric, formatUsed }: { label: string; metric: UsageMetric; formatUsed?: (n: number) => string }): JSX.Element {
  const pct = metric.limit === null ? 0 : Math.min(100, Math.round((metric.used / Math.max(metric.limit, 1)) * 100));
  const displayUsed = formatUsed ? formatUsed(metric.used) : String(metric.used);
  const displayLimit = metric.limit === null ? 'Unlimited' : formatUsed ? formatUsed(metric.limit) : String(metric.limit);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {displayUsed} / {displayLimit}
        </span>
      </div>
      {metric.limit !== null ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${String(pct)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function BillingPage(): JSX.Element {
  useDocumentTitle('Billing & Plan');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ['subscription', workspaceId],
    queryFn: () => getSubscription(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const { data: usage, isLoading: loadingUsage } = useQuery({
    queryKey: ['usage', workspaceId],
    queryFn: () => getUsage(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: listPlans, enabled: Boolean(workspaceId) });
  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ['invoices', workspaceId],
    queryFn: () => listInvoices(workspaceId),
    enabled: Boolean(workspaceId),
  });

  async function refreshAll(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['subscription', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['usage', workspaceId] }),
    ]);
  }

  async function handleChangePlan(plan: Plan): Promise<void> {
    if (!subscription) return;
    setActionError(null);
    setPendingAction(plan.key);
    try {
      const isUpgrade = plan.sortOrder >= subscription.plan.sortOrder;
      const result = isUpgrade ? await upgradePlan(workspaceId, plan.key) : await downgradePlan(workspaceId, plan.key);
      if (!result.applied && result.pending) {
        setActionError(result.reason ?? 'This plan change is pending — the workspace must become compliant with the target plan\'s limits first.');
      }
      await refreshAll();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancel(): Promise<void> {
    setActionError(null);
    setPendingAction('cancel');
    try {
      await cancelSubscription(workspaceId);
      await refreshAll();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReactivate(): Promise<void> {
    setActionError(null);
    setPendingAction('reactivate');
    try {
      await reactivateSubscription(workspaceId);
      await refreshAll();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  if (loadingSubscription || loadingUsage) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Billing &amp; Plan</h1>
        <p className="text-sm text-muted-foreground">Manage your subscription, usage, and billing history.</p>
      </div>

      {actionError ? (
        <Alert variant="danger">
          <p>Əməliyyat tamamlana bilmədi. Abunəliyiniz dəyişdirilmədi.</p>
          <p className="mt-1 text-xs opacity-80">{actionError}</p>
        </Alert>
      ) : null}

      {subscription ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{subscription.plan.name} plan</CardTitle>
              <CardDescription>
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                {subscription.cancelAtPeriodEnd ? ' — cancellation scheduled at period end' : ''}
              </CardDescription>
            </div>
            <Badge variant={STATUS_BADGE[subscription.status].variant}>{STATUS_BADGE[subscription.status].label}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {subscription.pendingPlan ? (
              <Alert variant="warning">
                Downgrade to {subscription.pendingPlan.name} is pending: {subscription.pendingPlanNote}
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {subscription.cancelAtPeriodEnd ? (
                <Button variant="secondary" onClick={() => void handleReactivate()} isLoading={pendingAction === 'reactivate'}>
                  Keep subscription
                </Button>
              ) : subscription.plan.key !== 'free' ? (
                <Button variant="outline" onClick={() => void handleCancel()} isLoading={pendingAction === 'cancel'}>
                  Cancel subscription
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {usage ? (
        <Card>
          <CardHeader>
            <CardTitle>Usage this period</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* AI credits are a rolling balance (grants minus consumption),
                NOT reset to the plan's monthlyAllowance every period — a
                plan upgrade doesn't immediately top up the balance to the
                new plan's allowance (that happens on the next period grant).
                Framing this as "used / limit" like the other bars would be
                misleading right after an upgrade (it would show a large
                "used" that is really just unclaimed allowance, not actual
                consumption) — found via live testing, fixed here. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">AI credits remaining</span>
                <span className="text-muted-foreground">
                  {usage.aiCredits.balance} <span className="text-xs">({usage.aiCredits.monthlyAllowance}/mo on this plan)</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${CREDIT_LIFECYCLE_COPY[getCreditLifecycleState(usage.aiCredits.balance, usage.aiCredits.monthlyAllowance)].barClass}`}
                  style={{ width: `${String(Math.min(100, Math.round((usage.aiCredits.balance / Math.max(usage.aiCredits.monthlyAllowance, 1)) * 100)))}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{CREDIT_LIFECYCLE_COPY[getCreditLifecycleState(usage.aiCredits.balance, usage.aiCredits.monthlyAllowance)].label}</span>
            </div>
            <UsageBar label="Team seats" metric={usage.teamSeats} />
            <UsageBar label="Business profiles" metric={usage.businessProfiles} />
            <UsageBar label="Active projects" metric={usage.activeProjects} />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">AI operations this period</span>
                <span className="text-muted-foreground">{usage.aiOperations.periodTotal}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Storage used</span>
                <span className="text-muted-foreground">{formatBytes(usage.storageBytes)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {plans && subscription ? (
        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>Upgrade or downgrade at any time. Downgrades that would exceed a limit are held pending until the workspace is compliant.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = plan.key === subscription.plan.key;
              return (
                <div key={plan.key} className={`flex flex-col gap-3 rounded-lg border p-4 ${isCurrent ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <div>
                    <p className="font-semibold text-foreground">{plan.name}</p>
                    <p className="text-2xl font-bold text-foreground">{formatCents(plan.priceMonthlyCents)}</p>
                  </div>
                  <ul className="flex-1 space-y-1 text-sm text-muted-foreground">
                    <li>{plan.aiCreditsPerMonth} AI credits/mo</li>
                    <li>{plan.maxTeamSeats ?? 'Unlimited'} team seats</li>
                    {plan.featureMatrix.advancedAnalytics ? <li>Advanced analytics</li> : null}
                    {plan.featureMatrix.apiAccess ? <li>API access</li> : null}
                  </ul>
                  <Button
                    variant={isCurrent ? 'secondary' : 'outline'}
                    disabled={isCurrent}
                    isLoading={pendingAction === plan.key}
                    onClick={() => void handleChangePlan(plan)}
                  >
                    {isCurrent ? 'Current plan' : plan.sortOrder >= subscription.plan.sortOrder ? 'Upgrade' : 'Downgrade'}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
        </CardHeader>
        {loadingInvoices ? null : !invoices || invoices.length === 0 ? (
          <CardContent>
            <EmptyState title="No invoices yet" description="Your billing history will appear here." />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.number}</TableCell>
                  <TableCell>
                    <Badge variant={invoice.status === 'PAID' ? 'success' : invoice.status === 'VOID' ? 'neutral' : 'warning'}>{invoice.status}</Badge>
                  </TableCell>
                  <TableCell>${(invoice.totalCents / 100).toFixed(2)}</TableCell>
                  <TableCell>{new Date(invoice.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
