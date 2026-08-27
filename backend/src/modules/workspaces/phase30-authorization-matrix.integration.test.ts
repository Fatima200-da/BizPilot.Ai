import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { inviteMember } from '../team/invitation.service';
import { changePlan } from '../billing/subscription.service';

/**
 * Phase 30 Track B.5: the full, real authorization matrix — every one of
 * this codebase's 7 real permissions (seed-rbac.ts) against every one of
 * its 6 real roles (OWNER/ADMIN/MANAGER/MEMBER/VIEWER/GUEST), verified via
 * real HTTP requests against the real endpoint that actually gates each
 * permission, not asserted from reading seed-rbac.ts's role definitions.
 *
 * This intentionally does NOT use the illustrative 4-role
 * (Owner/Admin/Member/Anonymous) matrix from the phase's own prompt — this
 * codebase has 6 real workspace roles plus a SEPARATE, orthogonal
 * `isSystemAdmin` platform flag (the real gate behind "Admin panel"), and
 * building the matrix from the real permission catalog is what actually
 * proves the system, rather than retrofitting reality to match a
 * simplified illustration.
 */
describe('Phase 30: full authorization matrix (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceId: string;
  let probeContactId: string;
  const roleTokens: Record<string, string> = {};
  const emails: string[] = [];

  function tokenFor(role: string): string {
    const token = roleTokens[role];
    if (!token) throw new Error(`No token set up for role ${role}`);
    return token;
  }

  async function addMember(roleKey: string): Promise<string> {
    const member = await registerTestUser(`Matrix ${roleKey}`);
    emails.push(member.email);
    const invite = await inviteMember(workspaceId, owner.userId, { email: member.email, roleKey });
    const acceptRes = await request(app).post(`/api/v1/invitations/${invite.token}/accept`).set('Authorization', `Bearer ${member.accessToken}`);
    expect(acceptRes.status).toBe(200);
    const selectRes = await request(app).post(`/api/v1/workspaces/${workspaceId}/select`).set('Authorization', `Bearer ${member.accessToken}`);
    return (selectRes.body as { data: { accessToken: string } }).data.accessToken;
  }

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Matrix Owner');
    emails.push(owner.email);
    const ws = await createTestWorkspace(owner.accessToken, 'Authorization Matrix Workspace');
    workspaceId = ws.workspaceId;
    await changePlan(workspaceId, 'business', owner.userId); // unlimited seats — need all 6 real roles present at once
    roleTokens.OWNER = ws.accessToken;
    roleTokens.ADMIN = await addMember('ADMIN');
    roleTokens.MANAGER = await addMember('MANAGER');
    roleTokens.MEMBER = await addMember('MEMBER');
    roleTokens.VIEWER = await addMember('VIEWER');
    roleTokens.GUEST = await addMember('GUEST');

    const contactRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${roleTokens.OWNER}`)
      .send({ fullName: 'Probe Contact For Lead Tests' });
    probeContactId = (contactRes.body as { data: { id: string } }).data.id;
  }, 30_000);

  afterAll(async () => {
    for (const email of emails) await cleanupTestUser(email);
  });

  // The real matrix, derived directly from seed-rbac.ts's SYSTEM_ROLES —
  // this table IS the assertion, not documentation of one.
  const MATRIX: Array<{
    permission: string;
    expected: Record<string, boolean>;
    request: (token: string) => Promise<request.Response>;
  }> = [
    {
      permission: 'workspace.manage (invite a member)',
      expected: { OWNER: true, ADMIN: true, MANAGER: false, MEMBER: false, VIEWER: false, GUEST: false },
      request: (token) =>
        request(app).post(`/api/v1/workspaces/${workspaceId}/members/invite`).set('Authorization', `Bearer ${token}`).send({ email: `probe-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`, roleKey: 'MEMBER' }),
    },
    {
      permission: 'billing.manage (attempt a subscription upgrade)',
      expected: { OWNER: true, ADMIN: false, MANAGER: false, MEMBER: false, VIEWER: false, GUEST: false },
      request: (token) => request(app).post(`/api/v1/workspaces/${workspaceId}/subscription/upgrade`).set('Authorization', `Bearer ${token}`).send({ planKey: 'business' }),
    },
    {
      permission: 'business_profile.manage (create a business profile)',
      expected: { OWNER: true, ADMIN: true, MANAGER: true, MEMBER: false, VIEWER: false, GUEST: false },
      request: (token) =>
        request(app)
          .post(`/api/v1/workspaces/${workspaceId}/business-profiles`)
          .set('Authorization', `Bearer ${token}`)
          .send({ name: `Probe Biz ${Date.now().toString()}`, industry: 'retail', targetAudience: 'general', contentLanguage: 'AZ' }),
    },
    {
      permission: 'contact.manage (create a contact)',
      expected: { OWNER: true, ADMIN: true, MANAGER: true, MEMBER: true, VIEWER: false, GUEST: false },
      request: (token) => request(app).post(`/api/v1/workspaces/${workspaceId}/crm/contacts`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Probe Contact', email: `probe-contact-${Date.now().toString()}@example.test` }),
    },
    {
      permission: 'lead.manage (create a lead)',
      expected: { OWNER: true, ADMIN: true, MANAGER: true, MEMBER: true, VIEWER: false, GUEST: false },
      request: (token) => request(app).post(`/api/v1/workspaces/${workspaceId}/crm/leads`).set('Authorization', `Bearer ${token}`).send({ contactId: probeContactId }),
    },
    {
      permission: 'workflow.approve (approve a workflow instance)',
      expected: { OWNER: true, ADMIN: true, MANAGER: true, MEMBER: false, VIEWER: false, GUEST: false },
      // A nonexistent instance id: the permission gate (authorize middleware) runs BEFORE
      // the handler resolves the instance, so a permitted role gets a real 404 (passed the
      // gate, failed to find the resource) while a forbidden role gets 403 (never reached
      // the handler at all) — the status code family alone distinguishes the two outcomes.
      request: (token) => request(app).post(`/api/v1/workspaces/${workspaceId}/workflow-instances/00000000-0000-4000-8000-000000000000/approve`).set('Authorization', `Bearer ${token}`).send({}),
    },
  ];

  for (const { permission, expected, request: makeRequest } of MATRIX) {
    it(`${permission}: matches the real seed-rbac.ts role definitions exactly for every role`, async () => {
      for (const [role, shouldSucceed] of Object.entries(expected)) {
        const token = roleTokens[role];
        if (!token) throw new Error(`No token set up for role ${role}`);
        const res = await makeRequest(token);
        if (shouldSucceed) {
          // "Permitted" means the authorize() gate let the request through
          // — the handler may still reject it for an unrelated reason
          // (404 resource-not-found, 422 validation), which is why this
          // checks "not a 403" rather than a specific success code.
          expect(res.status, `${role} should be PERMITTED for ${permission} (got ${String(res.status)})`).not.toBe(403);
        } else {
          expect(res.status, `${role} should be FORBIDDEN for ${permission} (got ${String(res.status)})`).toBe(403);
        }
      }
    });
  }

  it('workflow.execute (start a real workflow): OWNER/ADMIN/MANAGER/MEMBER all permitted, VIEWER/GUEST forbidden — verified via the real marketing-autopilot workflow start endpoint', async () => {
    const bpRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${tokenFor('OWNER')}`)
      .send({ name: 'Matrix Workflow Biz', industry: 'retail', targetAudience: 'general', contentLanguage: 'AZ' });
    const businessProfileId = (bpRes.body as { data: { id: string } }).data.id;

    const permitted = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];
    const forbidden = ['VIEWER', 'GUEST'];
    for (const role of permitted) {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send({ businessProfileId, objective: 'sales', platforms: ['instagram'] });
      expect(res.status, `${role} should be permitted to start a workflow (got ${String(res.status)})`).not.toBe(403);
    }
    for (const role of forbidden) {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send({ businessProfileId, objective: 'sales', platforms: ['instagram'] });
      expect(res.status, `${role} should be forbidden from starting a workflow (got ${String(res.status)})`).toBe(403);
    }
  }, 30_000);

  it('the Admin panel gate is completely orthogonal to every workspace role above — a real OWNER (even with every workspace permission) gets 403, and a real isSystemAdmin user with ZERO workspace memberships gets in', async () => {
    const ownerAdminRes = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${tokenFor('OWNER')}`);
    expect(ownerAdminRes.status).toBe(403);

    const platformAdmin = await registerTestUser('Matrix Platform Admin (no workspace)');
    emails.push(platformAdmin.email);
    await prisma.user.update({ where: { id: platformAdmin.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: platformAdmin.email, password: 'password1234' });
    const adminToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;

    const platformAdminRes = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(platformAdminRes.status).toBe(200);
  });

  it('an anonymous request (no Authorization header at all) is rejected with 401 before any permission or resource check, for every gated route', async () => {
    const routes = [
      { method: 'post' as const, path: `/api/v1/workspaces/${workspaceId}/members/invite` },
      { method: 'post' as const, path: `/api/v1/workspaces/${workspaceId}/subscription/upgrade` },
      { method: 'post' as const, path: `/api/v1/workspaces/${workspaceId}/crm/contacts` },
      { method: 'get' as const, path: '/api/v1/admin/dashboard' },
    ];
    for (const route of routes) {
      const res = await request(app)[route.method](route.path).send({});
      expect(res.status, `${route.method.toUpperCase()} ${route.path} should reject an anonymous request with 401`).toBe(401);
    }
  });
});
