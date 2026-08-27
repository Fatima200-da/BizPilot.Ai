import type { JSX } from 'react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui';
import { Alert, EmptyState, Skeleton } from '@/shared/components/feedback';
import { useAuth } from '@/app/providers/AuthProvider';
import { ASSIGNABLE_ROLES, cancelInvitation, changeMemberRole, inviteMember, listInvitations, listMembers, removeMember, type RoleKey } from '@/features/team/api/team.api';
import { getApiErrorMessage } from '@/shared/lib/api-client';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function TeamPage(): JSX.Element {
  useDocumentTitle('Team');
  const { auth } = useAuth();
  const workspaceId = auth?.workspaceId ?? '';
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState<RoleKey>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => listMembers(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const { data: invitations } = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => listInvitations(workspaceId),
    enabled: Boolean(workspaceId),
  });

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] }),
    ]);
  }

  async function handleInvite(): Promise<void> {
    setError(null);
    setInviting(true);
    try {
      await inviteMember(workspaceId, email, roleKey);
      setEmail('');
      await refresh();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string): Promise<void> {
    setError(null);
    setBusyMemberId(memberId);
    try {
      await removeMember(workspaceId, memberId);
      await refresh();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleRoleChange(memberId: string, newRole: RoleKey): Promise<void> {
    setError(null);
    setBusyMemberId(memberId);
    try {
      await changeMemberRole(workspaceId, memberId, newRole);
      await refresh();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleCancelInvite(invitationId: string): Promise<void> {
    setError(null);
    try {
      await cancelInvitation(workspaceId, invitationId);
      await refresh();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Team</h1>
        <p className="text-sm text-muted-foreground">Manage who has access to this workspace and their role.</p>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite a member</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleInvite();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Input type="email" placeholder="colleague@company.com" value={email} onChange={(e) => { setEmail(e.target.value); }} required className="max-w-xs" />
            <Select value={roleKey} onValueChange={(value) => { setRoleKey(value as RoleKey); }}>
              <SelectTrigger className="max-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" isLoading={inviting}>
              Send invitation
            </Button>
          </form>
        </CardContent>
      </Card>

      {invitations && invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell>{new Date(invite.expiresAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void handleCancelInvite(invite.id)}>
                      Cancel
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        {loadingMembers ? (
          <CardContent>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        ) : !members || members.length === 0 ? (
          <CardContent>
            <EmptyState title="No members yet" description="Invite your first teammate above." />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.user.fullName}</TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    {member.role.key === 'OWNER' ? (
                      <Badge variant="brand">Owner</Badge>
                    ) : (
                      <Select
                        value={member.role.key}
                        disabled={busyMemberId === member.id}
                        onValueChange={(value) => void handleRoleChange(member.id, value as RoleKey)}
                      >
                        <SelectTrigger className="max-w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.role.key !== 'OWNER' ? (
                      <Button variant="ghost" size="sm" isLoading={busyMemberId === member.id} onClick={() => void handleRemove(member.id)}>
                        Remove
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
