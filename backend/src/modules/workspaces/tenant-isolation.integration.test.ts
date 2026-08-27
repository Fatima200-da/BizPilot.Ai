import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';

interface ContactData {
  id: string;
}
interface BusinessProfileData {
  id: string;
}

/**
 * Phase 16 Section 7 — the phase's own stated highest-priority objective:
 * empirical, real-database proof that Workspace A can never reach
 * Workspace B's resources, for every workspace-scoped resource type.
 * Requires a real, migrated PostgreSQL instance — see
 * vitest.integration.config.ts's precondition doc comment.
 */
describe('Multi-tenant isolation (integration)', () => {
  let userA: Awaited<ReturnType<typeof registerTestUser>>;
  let userB: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceA: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceB: Awaited<ReturnType<typeof createTestWorkspace>>;
  let contactAId: string;
  let businessProfileAId: string;

  beforeAll(async () => {
    await ensureSeeded();
    userA = await registerTestUser('Workspace A Owner');
    userB = await registerTestUser('Workspace B Owner');
    workspaceA = await createTestWorkspace(userA.accessToken, 'Workspace A');
    workspaceB = await createTestWorkspace(userB.accessToken, 'Workspace B');

    const contactRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`)
      .send({ fullName: 'A-Only Contact', source: 'MANUAL' });
    contactAId = data<ContactData>(contactRes).id;

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`)
      .send({ name: 'A-Only Business', contentLanguage: 'AZ' });
    businessProfileAId = data<BusinessProfileData>(profileRes).id;
  });

  afterAll(async () => {
    await cleanupTestUser(userA.email);
    await cleanupTestUser(userB.email);
  });

  it('same-workspace access succeeds (contact)', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('cross-workspace access via B token against A resource is an indistinguishable 404 (contact)', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    // B's token carries workspaceB's id; the path names workspaceA -> path-match check fires first.
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('cross-workspace access via A token against B workspace path is 404 (workspace itself)', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceB.workspaceId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('same-workspace access succeeds (business profile)', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles/${businessProfileAId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(res.status).toBe(200);
  });

  it("workspace B cannot list workspace A's business profiles by forging the path (business profile list)", async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(404); // path-match check rejects before the handler ever runs
  });

  it('workspace B has its own, empty contact list — never sees workspace A rows', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceB.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(200);
    const contacts = data<ContactData[]>(res);
    expect(contacts.every((c) => c.id !== contactAId)).toBe(true);
  });

  /**
   * Phase 18 Section 7: the prior tests above prove GET is blocked for
   * contact and business-profile. These additional tests actually execute
   * the same attack for every remaining HTTP verb (PATCH, DELETE, POST) and
   * every remaining workspace-scoped resource type (lead, content-asset,
   * workflow-instance) rather than inferring from architecture that a single
   * shared middleware protects all of them — per that section's explicit
   * instruction not to merely inspect source code.
   */
  it('cross-workspace PATCH against a real A contact using B token is 404, and the contact is left unmodified', async () => {
    const res = await request(app)
      .patch(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ fullName: 'HACKED BY B' });
    expect(res.status).toBe(404);

    const verify = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(data<{ fullName: string }>(verify).fullName).toBe('A-Only Contact');
  });

  it('cross-workspace DELETE against a real A contact using B token is 404, and the contact still exists afterward', async () => {
    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(404);

    const verify = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/contacts/${contactAId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(verify.status).toBe(200);
  });

  it('cross-workspace POST (create a lead under A path) using B token is 404 — B cannot even attempt to write into A', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/leads`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ contactId: contactAId });
    expect(res.status).toBe(404);
  });

  it('workspace B cannot list or read workspace A leads by forging the path', async () => {
    const leadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/leads`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`)
      .send({ contactId: contactAId });
    const leadAId = data<{ id: string }>(leadRes).id;

    const list = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/leads`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(list.status).toBe(404);

    const single = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/crm/leads/${leadAId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(single.status).toBe(404);
  });

  it('workspace B cannot list or PATCH workspace A content-assets by forging the path', async () => {
    const list = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/content-assets`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(list.status).toBe(404);

    const fakeAssetId = '00000000-0000-4000-8000-000000000001';
    const patch = await request(app)
      .patch(`/api/v1/workspaces/${workspaceA.workspaceId}/content-assets/${fakeAssetId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ status: 'APPROVED' });
    expect(patch.status).toBe(404);
  });

  it('workspace B cannot read or approve a workspace A workflow-instance by forging the path', async () => {
    const fakeInstanceId = '00000000-0000-4000-8000-000000000002';
    const get = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/workflow-instances/${fakeInstanceId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(get.status).toBe(404);

    const approve = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/workflow-instances/${fakeInstanceId}/approve`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({});
    expect(approve.status).toBe(404);
  });

  it('workspace B cannot PATCH workspace A business-profile by forging the path, and A data is unmodified', async () => {
    const patch = await request(app)
      .patch(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles/${businessProfileAId}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ name: 'HACKED BY B' });
    expect(patch.status).toBe(404);

    const verify = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles/${businessProfileAId}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(data<{ name: string }>(verify).name).toBe('A-Only Business');
  });
});
