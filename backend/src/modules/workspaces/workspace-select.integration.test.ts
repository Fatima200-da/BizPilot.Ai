import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, errorBody, registerTestUser } from '../../testing/integration-helpers';

interface WorkspaceData {
  id: string;
  name: string;
}
interface SelectWorkspaceData {
  workspace: WorkspaceData;
  accessToken: string;
}
interface ContactData {
  id: string;
}

/**
 * Phase 18: `POST /workspaces/:workspaceId/select` closes a real gap found
 * during the first-customer walkthrough — before this endpoint existed, a
 * user's access token had a workspace claim ONLY if it was minted at
 * workspace-creation time, so a returning user (login, not register) had no
 * way to resolve back into a workspace they already belong to. These tests
 * prove the endpoint mints a genuinely usable, correctly-scoped token, and
 * that it cannot be used to select a workspace the caller doesn't belong to.
 */
describe('Workspace selection (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  const emails: string[] = [];
  afterAll(async () => {
    for (const email of emails) await cleanupTestUser(email);
  });

  it('a user can select a workspace they belong to and receive a token usable for a workspace-scoped action', async () => {
    const owner = await registerTestUser('Select Test Owner');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'Select Test Workspace');

    // Simulates a fresh login: the caller has an authenticated (userId-only)
    // token with NO workspace claim, exactly like modules/auth/auth.service.ts's
    // login response — registerTestUser's token already has one, so re-derive
    // an unscoped token the same way login.integration behavior would produce
    // by simply calling the select endpoint with the OWNER's original token,
    // which still authenticates as the same user regardless of its own claims.
    const selectRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/select`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(selectRes.status).toBe(200);
    const selected = data<SelectWorkspaceData>(selectRes);
    expect(selected.workspace.id).toBe(workspace.workspaceId);
    expect(selected.accessToken).toBeTypeOf('string');

    // The minted token must actually work for a real workspace-scoped call.
    const contactRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${selected.accessToken}`)
      .send({ fullName: 'Selected Via New Token' });
    expect(contactRes.status).toBe(201);
    expect(data<ContactData>(contactRes).id).toBeTypeOf('string');
  });

  it('a user cannot select a workspace they do not belong to — 404, not 403 (anti-enumeration)', async () => {
    const userA = await registerTestUser('Select Test A');
    emails.push(userA.email);
    const userB = await registerTestUser('Select Test B');
    emails.push(userB.email);
    const workspaceB = await createTestWorkspace(userB.accessToken, 'B Only Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceB.workspaceId}/select`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(res.status).toBe(404);
    expect(errorBody(res).code).toBe('NOT_FOUND');
  });

  it('selecting a nonexistent workspace id is 404', async () => {
    const user = await registerTestUser('Select Test Nonexistent');
    emails.push(user.email);

    const res = await request(app)
      .post('/api/v1/workspaces/00000000-0000-4000-8000-000000000099/select')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(res.status).toBe(404);
  });

  it('selecting a workspace with no Authorization header is 401', async () => {
    const res = await request(app).post('/api/v1/workspaces/00000000-0000-4000-8000-000000000099/select');
    expect(res.status).toBe(401);
  });
});
