import { apiClient } from '@/shared/lib/api-client';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface BusinessProfile {
  id: string;
  name: string;
  industry: string | null;
  description: string | null;
  targetAudience: string | null;
  offerings: Array<{ name: string; description?: string }>;
  contentLanguage: 'AZ' | 'EN' | 'RU';
}

export async function createWorkspace(name: string): Promise<{ workspace: Workspace; accessToken: string }> {
  const { data } = await apiClient.post<{ data: { workspace: Workspace; accessToken: string } }>('/workspaces', { name });
  return data.data;
}

/** Phase 18: a returning user's token has no workspace claim after login — this is how the app discovers workspaces they already belong to, so login never forces them back through onboarding. */
export async function listMyWorkspaces(): Promise<Workspace[]> {
  const { data } = await apiClient.get<{ data: Workspace[] }>('/workspaces');
  return data.data;
}

/** Mints a fresh access token scoped to an existing workspace the caller already belongs to (see backend workspace.service.ts's selectWorkspace). */
export async function selectWorkspace(workspaceId: string): Promise<{ workspace: Workspace; accessToken: string }> {
  const { data } = await apiClient.post<{ data: { workspace: Workspace; accessToken: string } }>(`/workspaces/${workspaceId}/select`);
  return data.data;
}

export interface CreateBusinessProfileInput {
  name: string;
  industry?: string;
  description?: string;
  targetAudience?: string;
  offerings?: Array<{ name: string; description?: string }>;
  contentLanguage?: 'AZ' | 'EN' | 'RU';
}

export async function createBusinessProfile(workspaceId: string, input: CreateBusinessProfileInput): Promise<BusinessProfile> {
  const { data } = await apiClient.post<{ data: BusinessProfile }>(`/workspaces/${workspaceId}/business-profiles`, input);
  return data.data;
}

export async function listBusinessProfiles(workspaceId: string): Promise<BusinessProfile[]> {
  const { data } = await apiClient.get<{ data: BusinessProfile[] }>(`/workspaces/${workspaceId}/business-profiles`);
  return data.data;
}
