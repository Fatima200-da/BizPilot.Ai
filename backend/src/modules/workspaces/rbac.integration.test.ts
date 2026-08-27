import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  addWorkspaceMemberWithRole,
  app,
  cleanupTestUser,
  createTestWorkspace,
  data,
  ensureSeeded,
  errorBody,
  registerTestUser,
} from '../../testing/integration-helpers';

interface ContactData {
  id: string;
}

/**
 * Phase 18 Section 8: closes Phase 17's documented RBAC negative-path gap.
 * Verifies both directions — a member with insufficient permission is
 * rejected with 403 and no internal leakage, and a member with sufficient
 * permission on the same route succeeds — so the guard is proven to
 * discriminate correctly, not just "always deny" or "always allow".
 */
describe('RBAC (integration): positive and negative permission paths', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  const emails: string[] = [];
  afterAll(async () => {
    for (const email of emails) await cleanupTestUser(email);
  });

  it('VIEWER (zero permissions) is rejected with 403 attempting a contact.manage action', async () => {
    const owner = await registerTestUser('RBAC Owner');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'RBAC Test Workspace');

    const viewerUser = await registerTestUser('RBAC Viewer');
    emails.push(viewerUser.email);
    const viewer = await addWorkspaceMemberWithRole(workspace.workspaceId, viewerUser.userId, 'VIEWER');

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ fullName: 'Should Be Rejected' });

    expect(res.status).toBe(403);
    const body = errorBody(res);
    expect(body.code).toBe('AUTHZ_INSUFFICIENT_PERMISSION');
    // Anti-leakage: the 403 body must never reveal internal permission-set
    // details, role hierarchy, or other members' identities.
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|stack|roleId|permissionKeys/i);
  });

  it('VIEWER can still perform actions that require only active membership, not a specific permission', async () => {
    const owner = await registerTestUser('RBAC Owner 2');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'RBAC Test Workspace 2');

    const viewerUser = await registerTestUser('RBAC Viewer 2');
    emails.push(viewerUser.email);
    const viewer = await addWorkspaceMemberWithRole(workspace.workspaceId, viewerUser.userId, 'VIEWER');

    // GET /contacts has no authorize() guard — any active member may list.
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(data<unknown[]>(res))).toBe(true);
  });

  it('MEMBER (has workflow.execute but not workflow.approve — seed-rbac.ts) is rejected with 403 approving a workflow instance', async () => {
    const owner = await registerTestUser('RBAC Owner 3');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'RBAC Test Workspace 3');

    const memberUser = await registerTestUser('RBAC Member');
    emails.push(memberUser.email);
    const member = await addWorkspaceMemberWithRole(workspace.workspaceId, memberUser.userId, 'MEMBER');

    // A syntactically valid but nonexistent workflow-instance id is enough:
    // the authorize() guard runs before the handler ever looks up the row,
    // so a 403 here proves the permission check fires first, not a 404.
    const fakeInstanceId = '00000000-0000-4000-8000-000000000000';
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/workflow-instances/${fakeInstanceId}/approve`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({});

    expect(res.status).toBe(403);
    expect(errorBody(res).code).toBe('AUTHZ_INSUFFICIENT_PERMISSION');
  });

  it('MANAGER succeeds creating a contact (has contact.manage)', async () => {
    const owner = await registerTestUser('RBAC Owner 4');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'RBAC Test Workspace 4');

    const managerUser = await registerTestUser('RBAC Manager 2');
    emails.push(managerUser.email);
    const manager = await addWorkspaceMemberWithRole(workspace.workspaceId, managerUser.userId, 'MANAGER');

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ fullName: 'Manager Created This' });

    expect(res.status).toBe(201);
    expect(data<ContactData>(res).id).toBeTypeOf('string');
  });

  it('a request with no Authorization header at all is rejected with 401 before any permission check', async () => {
    const owner = await registerTestUser('RBAC Owner 5');
    emails.push(owner.email);
    const workspace = await createTestWorkspace(owner.accessToken, 'RBAC Test Workspace 5');

    const res = await request(app).post(`/api/v1/workspaces/${workspace.workspaceId}/crm/contacts`).send({ fullName: 'No Auth' });

    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe('AUTH_REQUIRED');
  });
});
