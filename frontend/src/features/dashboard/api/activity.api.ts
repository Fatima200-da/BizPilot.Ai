import { apiClient } from '@/shared/lib/api-client';

export interface WorkspaceActivityItem {
  id: string;
  eventName: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export async function listRecentActivity(workspaceId: string): Promise<WorkspaceActivityItem[]> {
  const { data } = await apiClient.get<{ data: WorkspaceActivityItem[] }>(`/workspaces/${workspaceId}/events/activity`);
  return data.data;
}
