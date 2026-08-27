import { apiClient } from '@/shared/lib/api-client';

export interface Contact {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: 'WHATSAPP' | 'INSTAGRAM' | 'MANUAL' | 'IMPORT';
}

export async function listContacts(workspaceId: string): Promise<Contact[]> {
  const { data } = await apiClient.get<{ data: Contact[] }>(`/workspaces/${workspaceId}/crm/contacts`);
  return data.data;
}

export async function createContact(workspaceId: string, input: { fullName: string; phone?: string; email?: string }): Promise<Contact> {
  const { data } = await apiClient.post<{ data: Contact }>(`/workspaces/${workspaceId}/crm/contacts`, { ...input, source: 'MANUAL' });
  return data.data;
}
