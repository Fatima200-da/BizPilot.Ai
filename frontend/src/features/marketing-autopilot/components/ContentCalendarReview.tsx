import type { JSX } from 'react';
import { useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea } from '@/shared/components/ui';
import { Alert } from '@/shared/components/feedback';
import {
  approveWorkflowInstance,
  updateContentAsset,
  type ContentAsset,
  type WorkflowInstance,
} from '@/features/marketing-autopilot/api/marketing-autopilot.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';

const STATUS_LABEL: Record<ContentAsset['status'], string> = {
  DRAFT: 'Qaralama',
  IN_REVIEW: 'Baxılır',
  APPROVED: 'Təsdiqlənib',
  SCHEDULED: 'Planlaşdırılıb',
  PUBLISHED: 'Dərc edilib',
};

const STATUS_BADGE_VARIANT: Record<ContentAsset['status'], 'neutral' | 'info' | 'success'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  APPROVED: 'success',
  SCHEDULED: 'success',
  PUBLISHED: 'success',
};

function AssetCard({
  asset,
  workspaceId,
  onUpdated,
}: {
  asset: ContentAsset;
  workspaceId: string;
  onUpdated: (updated: ContentAsset) => void;
}): JSX.Element {
  const [caption, setCaption] = useState(asset.editedCaption ?? asset.caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdited = caption !== asset.caption;

  const handleSave = async (nextStatus?: 'IN_REVIEW' | 'APPROVED'): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateContentAsset(workspaceId, asset.id, {
        ...(isEdited ? { editedCaption: caption } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      });
      onUpdated(updated);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {asset.day}-ci gün · {asset.platform} · {asset.contentType}
          </span>
          <Badge variant={STATUS_BADGE_VARIANT[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
        </div>
        <p className="text-sm font-medium text-foreground">{asset.topic}</p>
        {error ? (
          <Alert variant="danger" onDismiss={() => { setError(null); }}>
            {error}
          </Alert>
        ) : null}
        <Textarea value={caption} onChange={(e) => { setCaption(e.target.value); }} rows={3} disabled={asset.status === 'APPROVED'} />
        {asset.visualDirection ? <p className="text-xs text-muted-foreground">Vizual: {asset.visualDirection}</p> : null}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" isLoading={saving} disabled={asset.status === 'APPROVED'} onClick={() => void handleSave('IN_REVIEW')}>
            Saxla
          </Button>
          <Button size="sm" isLoading={saving} disabled={asset.status === 'APPROVED'} onClick={() => void handleSave('APPROVED')}>
            Təsdiqlə
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContentCalendarReview({
  workspaceId,
  instance,
  onInstanceChange,
}: {
  workspaceId: string;
  instance: WorkflowInstance;
  onInstanceChange: (instance: WorkflowInstance) => void;
}): JSX.Element {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strategy = instance.output?.build_strategy;

  const handleApproveWorkflow = async (): Promise<void> => {
    setError(null);
    setApproving(true);
    try {
      const updated = await approveWorkflowInstance(workspaceId, instance.id);
      onInstanceChange(updated);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  const updateAssetInList = (updated: ContentAsset): void => {
    onInstanceChange({
      ...instance,
      contentAssets: instance.contentAssets.map((a) => (a.id === updated.id ? updated : a)),
    });
  };

  if (instance.status === 'FAILED') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Alert variant="danger" title="Iş axını uğursuz oldu">
          {instance.error?.message ?? 'Naməlum xəta baş verdi.'}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      {error ? (
        <Alert variant="danger" onDismiss={() => { setError(null); }}>
          {error}
        </Alert>
      ) : null}

      {strategy ? (
        <Card>
          <CardHeader>
            <CardTitle>Marketinq Strategiyası</CardTitle>
            <CardDescription>{strategy.objective}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-foreground">
            <p>
              <span className="font-medium">Auditoriya:</span> {strategy.audience}
            </p>
            <p>
              <span className="font-medium">Mövqeləndirmə:</span> {strategy.positioning}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {strategy.campaignThemes.map((theme) => (
                <Badge key={theme} variant="outline">
                  {theme}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {instance.status === 'AWAITING_APPROVAL' ? (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <p className="text-sm text-foreground">
              {instance.contentAssets.length} məzmun hazırlandı. Nəzərdən keçirin, redaktə edin, sonra planı təsdiqləyin.
            </p>
            <Button isLoading={approving} onClick={() => void handleApproveWorkflow()}>
              Planı təsdiqlə
            </Button>
          </CardContent>
        </Card>
      ) : instance.status === 'COMPLETED' ? (
        <Alert variant="success" title="Plan tamamlandı">
          30 günlük məzmun planınız hazırdır və işlənməyə davam edə bilərsiniz.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instance.contentAssets
          .slice()
          .sort((a, b) => a.day - b.day)
          .map((asset) => (
            <AssetCard key={asset.id} asset={asset} workspaceId={workspaceId} onUpdated={updateAssetInList} />
          ))}
      </div>
    </div>
  );
}
