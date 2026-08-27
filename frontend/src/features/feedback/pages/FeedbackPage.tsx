import type { JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui';
import { Alert, EmptyState, Skeleton } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { submitFeedback, listMyFeedback, type Feedback, type FeedbackType, type FeedbackStatus } from '@/features/feedback/api/feedback.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

const TYPE_LABEL: Record<FeedbackType, string> = { BUG: 'Xəta', IDEA: 'Fikir', QUESTION: 'Sual', GENERAL: 'Ümumi' };
const STATUS_BADGE: Record<FeedbackStatus, { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' }> = {
  OPEN: { label: 'Açıq', variant: 'info' },
  IN_REVIEW: { label: 'Baxılır', variant: 'warning' },
  RESOLVED: { label: 'Həll edildi', variant: 'success' },
  DISMISSED: { label: 'Bağlanıb', variant: 'neutral' },
};

/**
 * Phase 29 Section 24: a minimal in-app feedback channel — one form, one
 * list of the workspace's own submissions. No attachments, no threading,
 * no unnecessary personal data (the authenticated actor is already known
 * server-side).
 */
export function FeedbackPage(): JSX.Element {
  useDocumentTitle('Rəy bildir');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';
  const queryClient = useQueryClient();
  const [type, setType] = useState<FeedbackType>('GENERAL');
  const [message, setMessage] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ['feedback', workspaceId],
    queryFn: () => listMyFeedback(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitFeedback(workspaceId, { type, message }),
    onSuccess: () => {
      setMessage('');
      setSubmitError(null);
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ['feedback', workspaceId] });
    },
    onError: (err: unknown) => { setSubmitError(getApiErrorMessage(err)); },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Rəy bildir</h1>
        <p className="text-sm text-muted-foreground">Xəta tapmısınız, fikriniz var, ya da sualınız var? Bizə birbaşa bildirin.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Yeni rəy</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {submitError && <Alert variant="danger">{submitError}</Alert>}
          {submitted && !submitError && <Alert variant="success">Təşəkkürlər — rəyiniz göndərildi.</Alert>}
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(false);
              submitMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-type">Növ</Label>
              <Select value={type} onValueChange={(value) => { setType(value as FeedbackType); }}>
                <SelectTrigger id="feedback-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUG">{TYPE_LABEL.BUG}</SelectItem>
                  <SelectItem value="IDEA">{TYPE_LABEL.IDEA}</SelectItem>
                  <SelectItem value="QUESTION">{TYPE_LABEL.QUESTION}</SelectItem>
                  <SelectItem value="GENERAL">{TYPE_LABEL.GENERAL}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-message">Mesaj</Label>
              <Textarea
                id="feedback-message"
                placeholder="Nə baş verdiyini bizə deyin..."
                value={message}
                onChange={(e) => { setMessage(e.target.value); }}
                required
                minLength={1}
              />
            </div>
            <Button type="submit" isLoading={submitMutation.isPending} className="self-start">
              Göndər
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Əvvəlki rəyləriniz</CardTitle>
          <CardDescription>Bu iş sahəsindən göndərdiyiniz rəylər</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !items || items.length === 0 ? (
            <EmptyState title="Hələ rəy yoxdur" description="Göndərdiyiniz rəylər burada görünəcək." />
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item: Feedback) => (
                <li key={item.id} className="flex flex-col gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{TYPE_LABEL[item.type]}</span>
                    <Badge variant={STATUS_BADGE[item.status].variant}>{STATUS_BADGE[item.status].label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.message}</p>
                  <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
