import type { JSX } from 'react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { createContact, listContacts } from '@/features/crm/api/crm.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function CrmPage(): JSX.Element {
  useDocumentTitle('Müştərilər');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts', workspaceId],
    queryFn: () => listContacts(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const handleCreate = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      await createContact(workspaceId, { fullName, phone: phone || undefined });
      setFullName('');
      setPhone('');
      await queryClient.invalidateQueries({ queryKey: ['contacts', workspaceId] });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Müştərilər</h1>

      <Card>
        <CardHeader>
          <CardTitle>Yeni əlaqə əlavə et</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Input placeholder="Ad Soyad" value={fullName} onChange={(e) => { setFullName(e.target.value); }} required className="max-w-xs" />
            <Input placeholder="Telefon" value={phone} onChange={(e) => { setPhone(e.target.value); }} className="max-w-xs" />
            <Button type="submit" isLoading={saving}>
              Əlavə et
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? null : !contacts || contacts.length === 0 ? (
        <EmptyState title="Hələ heç bir əlaqə yoxdur" description="Yuxarıdakı formadan ilk müştərinizi əlavə edin." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Mənbə</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>{contact.fullName}</TableCell>
                  <TableCell>{contact.phone ?? '—'}</TableCell>
                  <TableCell>{contact.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
