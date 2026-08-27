/**
 * Phase 19 Section 15/16: one-off live security probe (not a permanent test
 * file — the permanent regression coverage for this lives in
 * tenant-isolation.integration.test.ts). Proves byte-identical 404 bodies
 * (aside from requestId) for "exists but belongs to another tenant" vs
 * "never existed at all", against a real running server via real HTTP.
 */
const BASE = 'http://localhost:4000/api/v1';

interface AuthResponse {
  data?: { accessToken: string; user: { id: string } };
}
interface WorkspaceResponse {
  data: { workspace: { id: string } };
}

async function register(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1234', fullName: 'Probe User' }),
  });
  const body = (await res.json()) as AuthResponse;
  if (!body.data) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return body.data.accessToken;
}

async function main(): Promise<void> {
  const suffix = Date.now();
  const tokenA = await register(`idor-a-${String(suffix)}@example.test`);
  const tokenB = await register(`idor-b-${String(suffix)}@example.test`);

  const wsRes = await fetch(`${BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Workspace A' }),
  });
  const wsBody = (await wsRes.json()) as WorkspaceResponse;
  const realWorkspaceId = wsBody.data.workspace.id;
  const fakeWorkspaceId = '00000000-0000-4000-8000-000000000000';

  const realRes = await fetch(`${BASE}/workspaces/${realWorkspaceId}`, { headers: { Authorization: `Bearer ${tokenB}` } });
  const fakeRes = await fetch(`${BASE}/workspaces/${fakeWorkspaceId}`, { headers: { Authorization: `Bearer ${tokenB}` } });

  const realBody = (await realRes.json()) as Record<string, unknown>;
  const fakeBody = (await fakeRes.json()) as Record<string, unknown>;
  delete realBody.requestId;
  delete fakeBody.requestId;
  delete realBody.instance;
  delete fakeBody.instance;

  console.log('real-but-not-mine status:', realRes.status, JSON.stringify(realBody));
  console.log('never-existed status:    ', fakeRes.status, JSON.stringify(fakeBody));
  const identical = realRes.status === fakeRes.status && JSON.stringify(realBody) === JSON.stringify(fakeBody);
  console.log(identical ? 'RESULT: IDENTICAL (zero enumeration signal)' : 'RESULT: DIFFERENT — POSSIBLE ENUMERATION LEAK');
}

main().catch((err: unknown) => {
  console.error('probe failed:', err);
  process.exit(1);
});
