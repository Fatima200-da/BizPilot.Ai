import { apiClient } from '@/shared/lib/api-client';

export type FeedbackType = 'BUG' | 'IDEA' | 'QUESTION' | 'GENERAL';
export type FeedbackStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';

export interface Feedback {
  id: string;
  workspaceId: string;
  userId: string;
  type: FeedbackType;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export async function submitFeedback(workspaceId: string, input: { type: FeedbackType; message: string }): Promise<Feedback> {
  const { data } = await apiClient.post<{ data: Feedback }>(`/workspaces/${workspaceId}/feedback`, input);
  return data.data;
}

export async function listMyFeedback(workspaceId: string): Promise<Feedback[]> {
  const { data } = await apiClient.get<{ data: Feedback[] }>(`/workspaces/${workspaceId}/feedback`);
  return data.data;
}
