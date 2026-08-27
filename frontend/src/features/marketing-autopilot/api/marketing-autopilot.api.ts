import { apiClient } from '@/shared/lib/api-client';

export type WorkflowInstanceStatus = 'PENDING' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'CANCELLED';

export interface ContentAsset {
  id: string;
  day: number;
  platform: string;
  contentType: string;
  pillarKey: string | null;
  topic: string;
  hook: string | null;
  keyMessage: string | null;
  caption: string;
  editedCaption: string | null;
  cta: string | null;
  visualDirection: string | null;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED';
}

export interface WorkflowStepRun {
  stepKey: string;
  status: string;
  attempt: number;
}

export interface WorkflowInstance {
  id: string;
  status: WorkflowInstanceStatus;
  currentStepKey: string | null;
  output: { build_strategy?: { objective: string; audience: string; positioning: string; campaignThemes: string[] } } | null;
  error: { step: string; message: string } | null;
  stepRuns: WorkflowStepRun[];
  contentAssets: ContentAsset[];
}

export async function startMarketingAutopilot(
  workspaceId: string,
  input: { businessProfileId: string; objective: 'awareness' | 'bookings' | 'sales'; platforms: string[] }
): Promise<WorkflowInstance> {
  const { data } = await apiClient.post<{ data: WorkflowInstance }>(`/workspaces/${workspaceId}/workflows/marketing-autopilot`, input);
  return data.data;
}

export async function getWorkflowInstance(workspaceId: string, instanceId: string): Promise<WorkflowInstance> {
  const { data } = await apiClient.get<{ data: WorkflowInstance }>(`/workspaces/${workspaceId}/workflow-instances/${instanceId}`);
  return data.data;
}

/** Phase 19: "resume my existing plan" — the most recent instance of this workflow definition for the workspace, or null if none exists yet. */
export async function getLatestWorkflowInstance(workspaceId: string, workflowDefinitionKey: string): Promise<WorkflowInstance | null> {
  const { data } = await apiClient.get<{ data: WorkflowInstance | null }>(`/workspaces/${workspaceId}/workflow-instances/latest`, {
    params: { workflowDefinitionKey },
  });
  return data.data;
}

export async function approveWorkflowInstance(workspaceId: string, instanceId: string): Promise<WorkflowInstance> {
  const { data } = await apiClient.post<{ data: WorkflowInstance }>(`/workspaces/${workspaceId}/workflow-instances/${instanceId}/approve`);
  return data.data;
}

export async function updateContentAsset(
  workspaceId: string,
  assetId: string,
  input: { editedCaption?: string; status?: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' }
): Promise<ContentAsset> {
  const { data } = await apiClient.patch<{ data: ContentAsset }>(`/workspaces/${workspaceId}/content-assets/${assetId}`, input);
  return data.data;
}
