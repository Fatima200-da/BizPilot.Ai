import axios, { type AxiosError } from 'axios';
import { getStoredAuth, setStoredAuth, clearStoredAuth } from '@/shared/lib/auth-storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const apiClient = axios.create({ baseURL: API_BASE_URL });

apiClient.interceptors.request.use((config) => {
  const auth = getStoredAuth();
  if (auth?.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  return config;
});

// API_CONTRACT.md Section 3.1's RFC 7807 Problem Details shape.
export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId?: string;
  errors?: Array<{ field: string; code: string; message: string }>;
}

export function isApiError(err: unknown): err is AxiosError<ApiErrorBody> {
  return axios.isAxiosError(err);
}

export function getApiErrorMessage(err: unknown): string {
  if (isApiError(err) && err.response?.data) {
    const body = err.response.data;
    if (body.errors && body.errors.length > 0) {
      return body.errors.map((e) => e.message).join(' ');
    }
    return body.detail || body.title || 'Something went wrong.';
  }
  return 'Something went wrong. Please check your connection and try again.';
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth?.refreshToken) return null;
  try {
    const response = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken: auth.refreshToken }
    );
    const { accessToken, refreshToken } = response.data.data;
    setStoredAuth({ ...auth, accessToken, refreshToken });
    return accessToken;
  } catch {
    clearStoredAuth();
    return null;
  }
}

// AUTH_ARCHITECTURE.md's rotate-on-refresh pattern: a single 401 triggers
// one refresh attempt (de-duplicated across concurrent requests), then
// retries the original request exactly once.
// Phase 18: a 401 from the auth endpoints themselves (wrong password, a
// register-time conflict path, or a rejected refresh) means "this attempt
// was invalid," not "your session expired" — the two were previously
// conflated, so a mistyped password would silently trigger this refresh
// dance, fail it (no refresh token exists pre-login), clear storage, and
// force a full-page reload to /login BEFORE the login form's own catch
// block could render "wrong password." That reload also destroyed the
// in-flight error before it ever painted. Excluding these paths lets the
// calling code's own try/catch handle its own 401 normally.
const AUTH_ENDPOINTS_EXEMPT_FROM_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh'];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config;
    const isAuthEndpoint = AUTH_ENDPOINTS_EXEMPT_FROM_REFRESH.some((path) => original?.url?.includes(path));
    if (error.response?.status === 401 && original && !isAuthEndpoint && !(original as { _retried?: boolean })._retried) {
      (original as { _retried?: boolean })._retried = true;
      refreshInFlight ??= refreshAccessToken();
      const newToken = await refreshInFlight;
      refreshInFlight = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      }
      clearStoredAuth();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
