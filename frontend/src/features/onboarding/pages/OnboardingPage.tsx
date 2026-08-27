import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui';
import { Alert } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { createBusinessProfile, createWorkspace } from '@/features/onboarding/api/onboarding.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

/**
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 20.1's first-time
 * journey: Create Workspace -> Describe Business, deliberately not asking
 * for a file upload here (that is the Business Analyzer's job) so the
 * fastest path to first value is the Marketing Autopilot, reachable
 * immediately after this two-step form.
 */
export function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { auth, setWorkspace } = useAuth();
  // Phase 34 Track B: a real refresh-safety defect found via browser testing
  // — a user who refreshed (or simply left and came back) between creating
  // their workspace (step 1) and submitting their business profile (step 2)
  // previously always restarted at step 1, which would have created a
  // SECOND workspace on re-submit (the exact duplicate-workspace bug
  // LoginPage's own doc comment already guards against on the login path).
  // If the authenticated user already has a selected workspace, this page
  // is now safely resumable directly at step 2 using that real workspace —
  // never re-creates one. This also closes the dead-end found on the
  // Marketing Autopilot page: its business-profile picker has no other way
  // to reach profile creation once onboarding's initial visit is over.
  const [step, setStep] = useState<1 | 2>(auth?.workspaceId ? 2 : 1);
  useDocumentTitle(step === 1 ? 'İş sahənizi yaradın' : 'Biznesinizi təsvir edin');
  const [workspaceId, setWorkspaceId] = useState<string | null>(auth?.workspaceId ?? null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [contentLanguage, setContentLanguage] = useState<'AZ' | 'EN' | 'RU'>('AZ');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreateWorkspace = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await createWorkspace(workspaceName);
      setWorkspace(result.workspace.id, result.accessToken);
      setWorkspaceId(result.workspace.id);
      setStep(2);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBusinessProfile = async (): Promise<void> => {
    if (!workspaceId) return;
    setError(null);
    setSubmitting(true);
    try {
      await createBusinessProfile(workspaceId, {
        name: businessName,
        industry: industry || undefined,
        targetAudience: targetAudience || undefined,
        contentLanguage,
      });
      // Phase 34 Track B: a real, empirically-found defect — the Dashboard
      // and Marketing Autopilot pages both cache business profiles under
      // the identical `['business-profiles', workspaceId]` query key with a
      // 30s default staleTime (QueryProvider.tsx). A user who ever visited
      // either page before completing this step (a real, easy-to-reach
      // path once the dashboard's own "describe your business" CTA exists)
      // would land back on a page still serving the stale, empty cached
      // result — a genuine dead end masquerading as a caching optimization.
      await queryClient.invalidateQueries({ queryKey: ['business-profiles', workspaceId] });
      void navigate('/marketing-autopilot');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{step === 1 ? 'İş sahənizi yaradın' : 'Biznesinizi təsvir edin'}</CardTitle>
          <CardDescription>
            {step === 1
              ? 'BizPilot AI-nin sizin üçün işləyəcəyi iş sahəsinin adını daxil edin.'
              : 'Bu məlumatlar BizPilot AI-nin sizin biznesinizi anlamasına kömək edir.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="danger" className="mb-4" onDismiss={() => { setError(null); }}>
              {error}
            </Alert>
          ) : null}

          {step === 1 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateWorkspace();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workspaceName">İş sahəsinin adı</Label>
                <Input
                  id="workspaceName"
                  placeholder="Məsələn: Günel Beauty Studio"
                  value={workspaceName}
                  onChange={(e) => { setWorkspaceName(e.target.value); }}
                  required
                />
              </div>
              <Button type="submit" isLoading={submitting} className="mt-2">
                Davam et
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateBusinessProfile();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="businessName">Biznes adı</Label>
                <Input id="businessName" value={businessName} onChange={(e) => { setBusinessName(e.target.value); }} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="industry">Sahə</Label>
                <Input
                  id="industry"
                  placeholder="Məsələn: Gözəllik salonu"
                  value={industry}
                  onChange={(e) => { setIndustry(e.target.value); }}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="targetAudience">Hədəf auditoriya</Label>
                <Textarea
                  id="targetAudience"
                  placeholder="Məsələn: Bakıda yaşayan 20-40 yaş qadınlar"
                  value={targetAudience}
                  onChange={(e) => { setTargetAudience(e.target.value); }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contentLanguage">Məzmun dili</Label>
                <Select value={contentLanguage} onValueChange={(value) => { setContentLanguage(value as 'AZ' | 'EN' | 'RU'); }}>
                  <SelectTrigger id="contentLanguage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AZ">Azərbaycan dili</SelectItem>
                    <SelectItem value="EN">English</SelectItem>
                    <SelectItem value="RU">Русский</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" isLoading={submitting} className="mt-2">
                Bitir və davam et
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
