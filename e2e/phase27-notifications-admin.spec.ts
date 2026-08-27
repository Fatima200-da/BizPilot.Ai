import { test, expect } from '@playwright/test';

/**
 * Phase 27 Section 21: new E2E scenarios enabled by this phase's new
 * frontend surfaces (notification center, admin control plane UI). Runs
 * against the same real browser + real backend + real (PGlite) persistence
 * harness as golden-path.spec.ts — see playwright.config.ts.
 */

function uniqueEmail(label: string): string {
  return `e2e-p27-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

test.describe('Phase 27: notification center', () => {
  test('a fresh registration produces a real WELCOME notification visible in the bell dropdown, and marking it read clears the badge', async ({ page }) => {
    const email = uniqueEmail('notif');
    await page.goto('/register');
    await page.getByLabel('Ad Soyad').fill('Notification Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Şifrə').fill('password1234');
    await page.getByRole('button', { name: 'Hesab yarat' }).click();

    await expect(page.getByText('İş sahənizi yaradın')).toBeVisible();
    await page.getByPlaceholder('Məsələn: Günel Beauty Studio').fill('Notification Test Workspace');
    await page.getByRole('button', { name: 'Davam et' }).click();
    await expect(page.getByText('Biznesinizi təsvir edin')).toBeVisible();
    await page.getByLabel('Biznes adı').fill('Notification Test Biz');
    await page.getByLabel('Sahə').fill('Test');
    await page.getByRole('button', { name: 'Bitir və davam et' }).click();
    await expect(page.getByRole('heading', { name: 'Aylıq Marketinq Planı Yaradın' })).toBeVisible();

    // The real WELCOME notification created at registration is reflected in
    // the bell's real unread count — not a placeholder/static badge.
    const bell = page.getByRole('button', { name: /Notifications/ });
    await expect(bell).toHaveAccessibleName(/unread/i);

    await bell.click();
    await expect(page.getByText(/Welcome to BizPilot AI/i)).toBeVisible();

    await page.getByRole('button', { name: 'Mark all read' }).click();
    // Close the dropdown before re-checking the trigger's accessible name —
    // while the Radix portal is open, the underlying page's accessibility
    // tree can transiently misreport the trigger during the re-render that
    // follows the mutation.
    await page.keyboard.press('Escape');
    await expect(bell).toHaveAccessibleName('Notifications');
  });

  test('the full notifications page lists the same real notification and supports navigating there from the bell', async ({ page }) => {
    const email = uniqueEmail('notif-page');
    await page.goto('/register');
    await page.getByLabel('Ad Soyad').fill('Notification Page User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Şifrə').fill('password1234');
    await page.getByRole('button', { name: 'Hesab yarat' }).click();
    await expect(page.getByText('İş sahənizi yaradın')).toBeVisible();
    await page.getByPlaceholder('Məsələn: Günel Beauty Studio').fill('Notification Page Workspace');
    await page.getByRole('button', { name: 'Davam et' }).click();
    await expect(page.getByText('Biznesinizi təsvir edin')).toBeVisible();
    await page.getByLabel('Biznes adı').fill('Notification Page Biz');
    await page.getByLabel('Sahə').fill('Test');
    await page.getByRole('button', { name: 'Bitir və davam et' }).click();
    await expect(page.getByRole('heading', { name: 'Aylıq Marketinq Planı Yaradın' })).toBeVisible();

    await page.getByRole('button', { name: /Notifications/ }).click();
    await page.getByRole('button', { name: 'View all notifications' }).click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/Welcome to BizPilot AI/i)).toBeVisible();
  });
});

test.describe('Phase 27: admin authorization at the UI layer', () => {
  test('a normal (non-admin) user never sees the Admin nav link, and a direct navigation to /admin shows a real error, never fabricated dashboard data', async ({ page }) => {
    const email = uniqueEmail('admin-authz');
    await page.goto('/register');
    await page.getByLabel('Ad Soyad').fill('Admin Authz Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Şifrə').fill('password1234');
    await page.getByRole('button', { name: 'Hesab yarat' }).click();
    await expect(page.getByText('İş sahənizi yaradın')).toBeVisible();
    await page.getByPlaceholder('Məsələn: Günel Beauty Studio').fill('Admin Authz Workspace');
    await page.getByRole('button', { name: 'Davam et' }).click();
    await expect(page.getByText('Biznesinizi təsvir edin')).toBeVisible();
    await page.getByLabel('Biznes adı').fill('Admin Authz Biz');
    await page.getByLabel('Sahə').fill('Test');
    await page.getByRole('button', { name: 'Bitir və davam et' }).click();
    await expect(page.getByRole('heading', { name: 'Aylıq Marketinq Planı Yaradın' })).toBeVisible();

    // Visibility is a UX nicety only, not the real gate — confirmed absent
    // for a normal user (the real gate is the server-side 403 checked next).
    await expect(page.getByRole('link', { name: 'Admin' })).not.toBeVisible();

    // Direct navigation must still be reachable at the ROUTE level (no
    // client-side route guard hides it — that would be client-side
    // "security" the spec explicitly rejects), but the DATA must be real:
    // the real 403 from GET /admin/dashboard, surfaced as a real error, not
    // silently swallowed or replaced with fabricated metrics.
    await page.goto('/admin');
    // The real InsufficientPermissionError message (app-error.ts), surfaced
    // as-is — not replaced with a generic client-side "access denied" the
    // server never validated.
    await expect(page.getByText(/administrator access/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Total users')).not.toBeVisible();
  });
});
