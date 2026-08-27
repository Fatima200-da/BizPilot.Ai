import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  roleKey: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'GUEST']),
});

export const changeMemberRoleSchema = z.object({
  roleKey: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'GUEST']),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
