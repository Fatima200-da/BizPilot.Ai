import { apiClient } from '@/shared/lib/api-client';

export interface AdminDashboardMetrics {
  totalUsers: number;
  activeUsers30d: number;
  totalWorkspaces: number;
  subscriptionsByStatus: Record<string, number>;
  aiOperationsTotal: number;
  creditsConsumedTotal: number;
  workflowExecutionsTotal: number;
  workflowsFailedTotal: number;
  systemHealth: 'healthy' | 'degraded';
}

export interface AdminUserSearchResult {
  id: string;
  email: string;
  fullName: string;
  isSystemAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  workspaces: Array<{ id: string; name: string; role: string; subscriptionStatus: string | null }>;
}

export interface AdminWorkspaceSearchResult {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  createdAt: string;
  isActive: boolean;
}

export async function getDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const { data } = await apiClient.get<{ data: AdminDashboardMetrics }>('/admin/dashboard');
  return data.data;
}

export async function searchUsers(query: string): Promise<AdminUserSearchResult[]> {
  const { data } = await apiClient.get<{ data: AdminUserSearchResult[] }>('/admin/users', { params: { q: query } });
  return data.data;
}

export async function searchWorkspaces(query: string): Promise<AdminWorkspaceSearchResult[]> {
  const { data } = await apiClient.get<{ data: AdminWorkspaceSearchResult[] }>('/admin/workspaces', { params: { q: query } });
  return data.data;
}

export interface AdminBackupRun {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'CORRUPT' | 'FAILED';
  triggerType: string;
  startedAt: string;
  durationMs: number | null;
  sizeBytes: number | null;
  rowCount: number | null;
  encrypted: boolean;
  s3Uploaded: boolean;
  restoreVerifiedOk: boolean | null;
  errorMessage: string | null;
}

export interface AdminBackupObservability {
  currentStatus: 'RUNNING' | 'HEALTHY' | 'UNHEALTHY' | 'NO_BACKUPS_YET';
  lastSuccessful: { id: string; startedAt: string; durationMs: number | null; sizeBytes: number | null; rowCount: number | null } | null;
  lastFailed: { id: string; startedAt: string; errorMessage: string | null } | null;
  backupAgeHours: number | null;
  consecutiveFailures: number;
  history: AdminBackupRun[];
}

/** Phase 32 Track K: real backup/disaster-recovery observability for the admin dashboard — every field read directly from `GET /admin/backups`, never hardcoded. */
export async function getBackupObservability(): Promise<AdminBackupObservability> {
  const { data } = await apiClient.get<{ data: AdminBackupObservability }>('/admin/backups');
  return data.data;
}

export async function triggerManualBackup(): Promise<AdminBackupRun> {
  const { data } = await apiClient.post<{ data: AdminBackupRun }>('/admin/backups/trigger');
  return data.data;
}

export interface AdminAlert {
  type: string;
  severity: 'critical' | 'warning';
  message: string;
  detectedAt: string;
  context: Record<string, unknown>;
}

/** Phase 33 Track F/M: real, live alert evaluation for the admin ops center — every alert computed from real current state, never a hardcoded example. */
export async function getAlerts(): Promise<{ alerts: AdminAlert[]; evaluatedAt: string }> {
  const { data } = await apiClient.get<{ data: { alerts: AdminAlert[]; evaluatedAt: string } }>('/admin/alerts');
  return data.data;
}

export interface AdminRetentionRun {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  triggerType: string;
  startedAt: string;
  totalPurged: number | null;
  purgedCounts: unknown;
  errorMessage: string | null;
}

export interface AdminRetentionObservability {
  currentStatus: 'RUNNING' | 'HEALTHY' | 'FAILED_RECENTLY' | 'NO_RUNS_YET';
  lastSuccessful: { id: string; startedAt: string; totalPurged: number | null } | null;
  lastFailed: { id: string; startedAt: string; errorMessage: string | null } | null;
  history: AdminRetentionRun[];
}

/** Phase 33 Track C/M: real data-retention purge observability. */
export async function getRetentionObservability(): Promise<AdminRetentionObservability> {
  const { data } = await apiClient.get<{ data: AdminRetentionObservability }>('/admin/retention');
  return data.data;
}

export async function getRetentionPreview(): Promise<{ lead: number; contact: number; workspaceMember: number }> {
  const { data } = await apiClient.get<{ data: { lead: number; contact: number; workspaceMember: number } }>('/admin/retention/preview');
  return data.data;
}

export async function triggerManualPurge(): Promise<AdminRetentionRun> {
  const { data } = await apiClient.post<{ data: AdminRetentionRun }>('/admin/retention/trigger');
  return data.data;
}
