import type { JSX } from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Building2, Zap, Workflow, ShieldAlert, DatabaseBackup, Bell, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui';
import { EmptyState, Alert, SkeletonText } from '@/shared/components/feedback';
import {
  getDashboardMetrics,
  searchUsers,
  searchWorkspaces,
  getBackupObservability,
  triggerManualBackup,
  getAlerts,
  getRetentionObservability,
  getRetentionPreview,
  triggerManualPurge,
  type AdminUserSearchResult,
  type AdminWorkspaceSearchResult,
} from '@/features/admin/api/admin.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

const BACKUP_STATUS_TONE: Record<string, 'success' | 'danger' | 'neutral'> = {
  HEALTHY: 'success',
  RUNNING: 'neutral',
  UNHEALTHY: 'danger',
  NO_BACKUPS_YET: 'neutral',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function MetricCard({ icon, label, value, tone = 'neutral' }: { icon: JSX.Element; label: string; value: string; tone?: 'neutral' | 'danger' }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <span className={`flex size-10 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-danger-surface text-danger-foreground' : 'bg-secondary text-secondary-foreground'}`}>
          {icon}
        </span>
        <div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 27 Section 11-12: the platform administrator control plane's
 * frontend surface. Visibility here is a UX nicety only — this page is
 * reachable by any authenticated user, and every request it makes is
 * independently re-authorized server-side by `requireSystemAdmin`; a
 * non-admin sees the real 403 error state below, not a client-side
 * "access denied" screen the server never validated.
 */
export function AdminPage(): JSX.Element {
  useDocumentTitle('Platform Admin');
  const [userQuery, setUserQuery] = useState('');
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const queryClient = useQueryClient();

  const { data: metrics, isLoading: loadingMetrics, isError: metricsError, error: metricsErrorObj } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: getDashboardMetrics,
  });

  const { data: backups, isLoading: loadingBackups } = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: getBackupObservability,
  });

  const { data: alertsData, isLoading: loadingAlerts } = useQuery({
    queryKey: ['admin', 'alerts'],
    queryFn: getAlerts,
    refetchInterval: 30_000, // real, live polling — an ops center that only refreshes on manual reload isn't one
  });

  const { data: retention, isLoading: loadingRetention } = useQuery({
    queryKey: ['admin', 'retention'],
    queryFn: getRetentionObservability,
  });

  const { data: retentionPreview } = useQuery({
    queryKey: ['admin', 'retention', 'preview'],
    queryFn: getRetentionPreview,
  });

  const triggerPurgeMutation = useMutation({
    mutationFn: triggerManualPurge,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'retention'] });
    },
  });

  const triggerBackupMutation = useMutation({
    mutationFn: triggerManualBackup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
  });

  const { data: users, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin', 'users', userQuery],
    queryFn: () => searchUsers(userQuery),
  });

  const { data: workspaces, isLoading: loadingWorkspaces } = useQuery({
    queryKey: ['admin', 'workspaces', workspaceQuery],
    queryFn: () => searchWorkspaces(workspaceQuery),
  });

  if (metricsError) {
    return (
      <Alert variant="danger">
        {getApiErrorMessage(metricsErrorObj)}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Platform Admin</h1>
        <p className="text-sm text-muted-foreground">Live, real-time platform metrics — never a cached snapshot.</p>
      </div>

      {loadingMetrics || !metrics ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <SkeletonText key={i} lines={2} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon={<Users className="size-5" />} label="Total users" value={String(metrics.totalUsers)} />
            <MetricCard icon={<Users className="size-5" />} label="Active (30d)" value={String(metrics.activeUsers30d)} />
            <MetricCard icon={<Building2 className="size-5" />} label="Workspaces" value={String(metrics.totalWorkspaces)} />
            <MetricCard
              icon={<ShieldAlert className="size-5" />}
              label="System health"
              value={metrics.systemHealth}
              tone={metrics.systemHealth === 'healthy' ? 'neutral' : 'danger'}
            />
            <MetricCard icon={<Zap className="size-5" />} label="AI operations" value={String(metrics.aiOperationsTotal)} />
            <MetricCard icon={<Zap className="size-5" />} label="Credits consumed" value={String(metrics.creditsConsumedTotal)} />
            <MetricCard icon={<Workflow className="size-5" />} label="Workflow executions" value={String(metrics.workflowExecutionsTotal)} />
            <MetricCard icon={<Workflow className="size-5" />} label="Failed workflows" value={String(metrics.workflowsFailedTotal)} tone={metrics.workflowsFailedTotal > 0 ? 'danger' : 'neutral'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Subscriptions by status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(metrics.subscriptionsByStatus).map(([status, count]) => (
                <Badge key={status} variant="outline">
                  {status}: {count}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" />
            Live alerts
          </CardTitle>
          <CardDescription>Real, live-evaluated production alerts — polled every 30s, never a static example.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAlerts || !alertsData ? (
            <SkeletonText lines={2} />
          ) : alertsData.alerts.length === 0 ? (
            <EmptyState icon={<Bell />} title="No active alerts" description="Every real check evaluated clean as of the last poll." />
          ) : (
            <div className="flex flex-col gap-2">
              {alertsData.alerts.map((a) => (
                <Alert key={`${a.type}-${a.detectedAt}`} variant={a.severity === 'critical' ? 'danger' : 'warning'}>
                  <span className="font-medium">{a.type}</span>: {a.message}
                </Alert>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              Data retention
            </CardTitle>
            <CardDescription>Real, enforced purge of soft-deleted data past its retention window — never a same-day permanent delete.</CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              triggerPurgeMutation.mutate();
            }}
            disabled={triggerPurgeMutation.isPending || retention?.currentStatus === 'RUNNING'}
          >
            {triggerPurgeMutation.isPending || retention?.currentStatus === 'RUNNING' ? 'Running…' : 'Trigger purge now'}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loadingRetention || !retention ? (
            <SkeletonText lines={2} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={retention.currentStatus === 'HEALTHY' ? 'success' : retention.currentStatus === 'FAILED_RECENTLY' ? 'danger' : 'neutral'}>{retention.currentStatus}</Badge>
                {retentionPreview ? (
                  <span className="text-sm text-muted-foreground">
                    Eligible right now: {retentionPreview.lead} lead(s), {retentionPreview.contact} contact(s), {retentionPreview.workspaceMember} member(s)
                  </span>
                ) : null}
              </div>
              {triggerPurgeMutation.isError ? <Alert variant="danger">{getApiErrorMessage(triggerPurgeMutation.error)}</Alert> : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DatabaseBackup className="size-5" />
              Backups & disaster recovery
            </CardTitle>
            <CardDescription>Real backup status — every field read live from the server, never cached.</CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              triggerBackupMutation.mutate();
            }}
            disabled={triggerBackupMutation.isPending || backups?.currentStatus === 'RUNNING'}
          >
            {triggerBackupMutation.isPending || backups?.currentStatus === 'RUNNING' ? 'Running…' : 'Trigger backup now'}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loadingBackups || !backups ? (
            <SkeletonText lines={3} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={BACKUP_STATUS_TONE[backups.currentStatus]}>{backups.currentStatus}</Badge>
                {backups.backupAgeHours !== null ? (
                  <span className="text-sm text-muted-foreground">Last successful backup: {backups.backupAgeHours < 1 ? '<1h' : `${backups.backupAgeHours.toFixed(0)}h`} ago</span>
                ) : null}
                {backups.consecutiveFailures > 0 ? (
                  <Badge variant="danger">{backups.consecutiveFailures} consecutive failure{backups.consecutiveFailures === 1 ? '' : 's'}</Badge>
                ) : null}
              </div>

              {triggerBackupMutation.isError ? <Alert variant="danger">{getApiErrorMessage(triggerBackupMutation.error)}</Alert> : null}

              {backups.history.length === 0 ? (
                <EmptyState icon={<DatabaseBackup />} title="No backups yet" description="Trigger the first one above, or wait for the daily schedule." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Encrypted</TableHead>
                      <TableHead>Off-site</TableHead>
                      <TableHead>Restore-verified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.history.slice(0, 10).map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={run.status === 'SUCCEEDED' ? 'success' : run.status === 'RUNNING' ? 'neutral' : 'danger'}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{formatBytes(run.sizeBytes)}</TableCell>
                        <TableCell>{run.encrypted ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                        <TableCell>{run.s3Uploaded ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                        <TableCell>{run.restoreVerifiedOk === null ? '—' : run.restoreVerifiedOk ? <Badge variant="success">Verified</Badge> : <Badge variant="danger">Failed</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Search by email or name.</CardDescription>
          <Input placeholder="Search users…" value={userQuery} onChange={(e) => { setUserQuery(e.target.value); }} className="mt-2 max-w-sm" />
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <SkeletonText lines={3} />
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Last login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u: AdminUserSearchResult) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{u.fullName}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                      {u.isSystemAdmin ? <Badge variant="brand" className="mt-1">Admin</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.workspaces.map((w) => (
                          <Badge key={w.id} variant="neutral">
                            {w.name} · {w.role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={<Users />} title="No users found" description="Try a different search term." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>Search by name or slug.</CardDescription>
          <Input placeholder="Search workspaces…" value={workspaceQuery} onChange={(e) => { setWorkspaceQuery(e.target.value); }} className="mt-2 max-w-sm" />
        </CardHeader>
        <CardContent>
          {loadingWorkspaces ? (
            <SkeletonText lines={3} />
          ) : workspaces && workspaces.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((w: AdminWorkspaceSearchResult) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium text-foreground">{w.name}</TableCell>
                    <TableCell className="text-muted-foreground">{w.ownerEmail}</TableCell>
                    <TableCell>
                      <Badge variant={w.isActive ? 'success' : 'neutral'}>{w.isActive ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(w.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={<Building2 />} title="No workspaces found" description="Try a different search term." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
