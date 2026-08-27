import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/feedback';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

/**
 * Phase 34 Track M/L: the catch-all route previously silently redirected an
 * unknown URL to "/" with no explanation — indistinguishable from a real
 * navigation bug to a real user (did my link break? did I mistype a URL? is
 * something wrong with my account?). A visible, honest "page not found"
 * state with a real way back is the correct customer-facing behavior for an
 * SPA that cannot return a real HTTP 404 status from client-side routing.
 */
export function NotFoundPage(): JSX.Element {
  useDocumentTitle('Səhifə tapılmadı');
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <EmptyState
        title="Səhifə tapılmadı"
        description="Axtardığınız səhifə mövcud deyil və ya köçürülüb. Ünvanı yoxlayın və ya əsas panelə qayıdın."
        action={<Button onClick={() => { void navigate('/'); }}>Əsas panelə qayıt</Button>}
      />
    </div>
  );
}
