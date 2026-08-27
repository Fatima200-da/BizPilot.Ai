import { apiClient } from '@/shared/lib/api-client';

export interface Plan {
  id: string;
  key: string;
  tier: string;
  name: string;
  description: string | null;
  priceMonthlyCents: number | null;
  priceAnnualCents: number | null;
  aiCreditsPerMonth: number;
  maxTeamSeats: number | null;
  maxBusinessProfiles: number | null;
  maxActiveProjects: number | null;
  featureMatrix: { advancedAnalytics: boolean; apiAccess: boolean; priorityProcessing: boolean; export: boolean; customIntegrations: boolean };
  sortOrder: number;
}

export interface Subscription {
  id: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | 'PAUSED';
  billingInterval: 'MONTHLY' | 'ANNUAL';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  plan: Plan;
  pendingPlan: Plan | null;
  pendingPlanNote: string | null;
}

export interface UsageMetric {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface UsageSummary {
  aiCredits: { balance: number; monthlyAllowance: number };
  aiOperations: { periodTotal: number };
  workflowExecutions: { total: number };
  teamSeats: UsageMetric;
  businessProfiles: UsageMetric;
  activeProjects: UsageMetric;
  storageBytes: number;
}

export interface Invoice {
  id: string;
  number: string;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  subtotalCents: number;
  totalCents: number;
  currency: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ChangePlanResult {
  applied: boolean;
  pending: boolean;
  reason?: string;
  subscription: Subscription;
}

export async function listPlans(): Promise<Plan[]> {
  const { data } = await apiClient.get<{ data: Plan[] }>('/plans');
  return data.data;
}

export async function getSubscription(workspaceId: string): Promise<Subscription> {
  const { data } = await apiClient.get<{ data: Subscription }>(`/workspaces/${workspaceId}/subscription`);
  return data.data;
}

export async function upgradePlan(workspaceId: string, planKey: string): Promise<ChangePlanResult> {
  const { data } = await apiClient.post<{ data: ChangePlanResult }>(`/workspaces/${workspaceId}/subscription/upgrade`, { planKey });
  return data.data;
}

export async function downgradePlan(workspaceId: string, planKey: string): Promise<ChangePlanResult> {
  const { data } = await apiClient.post<{ data: ChangePlanResult }>(`/workspaces/${workspaceId}/subscription/downgrade`, { planKey });
  return data.data;
}

export async function cancelSubscription(workspaceId: string): Promise<{ subscription: Subscription }> {
  const { data } = await apiClient.post<{ data: { subscription: Subscription } }>(`/workspaces/${workspaceId}/subscription/cancel`, {});
  return data.data;
}

export async function reactivateSubscription(workspaceId: string): Promise<Subscription> {
  const { data } = await apiClient.post<{ data: Subscription }>(`/workspaces/${workspaceId}/subscription/reactivate`);
  return data.data;
}

export async function getUsage(workspaceId: string): Promise<UsageSummary> {
  const { data } = await apiClient.get<{ data: UsageSummary }>(`/workspaces/${workspaceId}/usage`);
  return data.data;
}

export async function listInvoices(workspaceId: string): Promise<Invoice[]> {
  const { data } = await apiClient.get<{ data: Invoice[] }>(`/workspaces/${workspaceId}/billing/invoices`);
  return data.data;
}
