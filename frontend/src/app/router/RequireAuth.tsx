import type { JSX } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthProvider';

export function RequireAuth(): JSX.Element {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireWorkspace(): JSX.Element {
  const { hasWorkspace } = useAuth();
  if (!hasWorkspace) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
