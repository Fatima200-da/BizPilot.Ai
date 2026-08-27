import { apiClient } from '@/shared/lib/api-client';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  locale: string;
  isSystemAdmin: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export async function register(input: { email: string; password: string; fullName: string }): Promise<AuthResponse> {
  const { data } = await apiClient.post<{ data: AuthResponse }>('/auth/register', input);
  return data.data;
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  const { data } = await apiClient.post<{ data: AuthResponse }>('/auth/login', input);
  return data.data;
}
