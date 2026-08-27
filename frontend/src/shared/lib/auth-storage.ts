export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  fullName: string;
  workspaceId: string | null;
  // Phase 27: UX-only — determines whether the "Admin" nav link renders.
  // Every admin API route independently re-verifies this server-side from
  // the JWT; this stored value is never itself an authorization check.
  isSystemAdmin: boolean;
}

const STORAGE_KEY = 'bizpilot-ai:auth';

export function getStoredAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  window.dispatchEvent(new Event('bizpilot-ai:auth-changed'));
}

export function clearStoredAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('bizpilot-ai:auth-changed'));
}
