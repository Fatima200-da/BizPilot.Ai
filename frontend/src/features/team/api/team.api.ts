import { apiClient } from '@/shared/lib/api-client';

export interface Member {
  id: string;
  userId: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  user: { id: string; email: string; fullName: string; avatarUrl: string | null };
  role: { id: string; key: string; name: string };
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export type RoleKey = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER' | 'GUEST';
export const ASSIGNABLE_ROLES: RoleKey[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const { data } = await apiClient.get<{ data: Member[] }>(`/workspaces/${workspaceId}/members`);
  return data.data;
}

export async function inviteMember(workspaceId: string, email: string, roleKey: RoleKey): Promise<void> {
  await apiClient.post(`/workspaces/${workspaceId}/members/invite`, { email, roleKey });
}

export async function removeMember(workspaceId: string, memberId: string): Promise<void> {
  await apiClient.delete(`/workspaces/${workspaceId}/members/${memberId}`);
}

export async function changeMemberRole(workspaceId: string, memberId: string, roleKey: RoleKey): Promise<void> {
  await apiClient.patch(`/workspaces/${workspaceId}/members/${memberId}/role`, { roleKey });
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const { data } = await apiClient.get<{ data: Invitation[] }>(`/workspaces/${workspaceId}/invitations`);
  return data.data;
}

export async function cancelInvitation(workspaceId: string, invitationId: string): Promise<void> {
  await apiClient.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`);
}

export async function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  const { data } = await apiClient.post<{ data: { workspaceId: string } }>(`/invitations/${token}/accept`);
  return data.data;
}
