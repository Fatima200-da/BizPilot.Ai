import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Badge,
} from '@/shared/components/ui';
import { Alert } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { listBusinessProfiles } from '@/features/onboarding/api/onboarding.api';
import {
  getLatestWorkflowInstance,
  getWorkflowInstance,
  startMarketingAutopilot,
  type WorkflowInstance,
} from '@/features/marketing-autopilot/api/marketing-autopilot.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { ContentCalendarReview } from '@/features/marketing-autopilot/components/ContentCalendarReview';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

const WORKFLOW_DEFINITION_KEY = 'marketing-autopilot';

const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

/**
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 12 / Phase 15 Section 24's
 * guided flow. The Workflow Engine (backend) executes in-process within the
 * HTTP request (Section 15.3 of that document), so `startMarketingAutopilot`
 * already returns the AWAITING_APPROVAL instance — no polling loop needed.
 */
export function MarketingAutopilotPage(): JSX.Element {
  useDocumentTitle('Marketinq Avtopiloti');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';

  const { data: businessProfiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['business-profiles', workspaceId],
    queryFn: () => listBusinessProfiles(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // Phase 19 / Phase 18 Section 27: "resume my existing plan" — a returning
  // user who already generated a plan sees it again instead of always
  // landing on the "start a new plan" form (the documented gap in
  // docs/FIRST_CUSTOMER_READINESS.md).
  const { data: latestInstance, isLoading: latestLoading } = useQuery({
    queryKey: ['latest-workflow-instance', workspaceId],
    queryFn: () => getLatestWorkflowInstance(workspaceId, WORKFLOW_DEFINITION_KEY),
    enabled: Boolean(workspaceId),
  });

  const [businessProfileId, setBusinessProfileId] = useState('');
  const [objective, setObjective] = useState<'awareness' | 'bookings' | 'sales'>('bookings');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [viewingNewForm, setViewingNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const togglePlatform = (value: string): void => {
    setPlatforms((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  };

  const handleStart = async (): Promise<void> => {
    setError(null);
    setStarting(true);
    try {
      const started = await startMarketingAutopilot(workspaceId, { businessProfileId, objective, platforms });
      // The initial response doesn't include relations (contentAssets,
      // stepRuns) — fetch the full detail once the synchronous run settles.
      const detailed = await getWorkflowInstance(workspaceId, started.id);
      setInstance(detailed);
      setViewingNewForm(false);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const effectiveInstance = instance ?? (viewingNewForm ? null : (latestInstance ?? null));

  if (!effectiveInstance && !viewingNewForm && latestLoading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <p className="text-sm text-muted-foreground">Yüklənir...</p>
      </div>
    );
  }

  if (effectiveInstance) {
    return (
      <div className="flex flex-col gap-4">
        <div className="mx-auto flex w-full max-w-5xl justify-end px-6 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setInstance(null);
              setViewingNewForm(true);
            }}
          >
            Yeni plan yarat
          </Button>
        </div>
        <ContentCalendarReview workspaceId={workspaceId} instance={effectiveInstance} onInstanceChange={setInstance} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Aylıq Marketinq Planı Yaradın</CardTitle>
          <CardDescription>
            Business → audience → objective → strategy → content → measurement. BizPilot AI biznesinizi anlayaraq 30 günlük
            məzmun planı hazırlayacaq.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error ? (
            <Alert variant="danger" onDismiss={() => { setError(null); }}>
              <p>Generasiya uğursuz oldu. Kreditləriniz itirilmədi — yalnız uğurlu nəticələr üçün kredit çıxılır.</p>
              <p className="mt-1 text-xs opacity-80">{error}</p>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>Biznes profili</Label>
            {profilesLoading ? (
              <p className="text-sm text-muted-foreground">Yüklənir...</p>
            ) : (businessProfiles ?? []).length === 0 ? (
              // Phase 34 Track B/L: a real dead-end found via browser testing
              // — a workspace with zero business profiles previously showed
              // a silently empty dropdown and a disabled submit button, with
              // no explanation. This is the only place that gap is visible,
              // since business-profile creation only otherwise happens
              // during initial onboarding.
              <p className="text-sm text-muted-foreground">
                Hələ biznes profiliniz yoxdur.{' '}
                <Link to="/onboarding" className="text-primary underline-offset-4 hover:underline">
                  Əvvəlcə biznesinizi təsvir edin
                </Link>
                .
              </p>
            ) : (
              <Select value={businessProfileId} onValueChange={setBusinessProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Biznes profilini seçin" />
                </SelectTrigger>
                <SelectContent>
                  {(businessProfiles ?? []).map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Məqsədiniz nədir?</Label>
            <Select value={objective} onValueChange={(v) => { setObjective(v as typeof objective); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="awareness">Tanınmanın artırılması</SelectItem>
                <SelectItem value="bookings">Rezervlərin artırılması</SelectItem>
                <SelectItem value="sales">Satışların artırılması</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Hansı platformalar?</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { togglePlatform(opt.value); }}
                  className="focus-visible:outline-none"
                >
                  <Badge variant={platforms.includes(opt.value) ? 'brand' : 'neutral'} className="cursor-pointer px-3 py-1.5">
                    {opt.label}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => void handleStart()}
            isLoading={starting}
            disabled={!businessProfileId || platforms.length === 0}
          >
            Strategiya yarat
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
