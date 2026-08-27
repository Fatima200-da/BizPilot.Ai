import { test, expect } from '@playwright/test';

/**
 * Phase 34 Track B: a real defect found via manual browser testing — a user
 * who created a workspace (onboarding step 1) but reloaded or navigated
 * away before submitting their business profile (step 2) previously landed
 * on the dashboard with a real "business profile not found" empty state
 * that had NO way back to complete it, and separately, the Marketing
 * Autopilot page's business-profile picker silently showed an empty
 * dropdown with a disabled submit button and no explanation — a genuine
 * dead end. Root cause: OnboardingPage always restarted at step 1 even for
 * a user who already had a workspace, which would have created a SECOND
 * workspace on resubmission — so the page could never safely be revisited.
 * Fixed by making OnboardingPage resume directly at step 2 when the
 * authenticated user already has a workspace, and adding real CTAs on both
 * the dashboard's empty state and the Marketing Autopilot picker.
 */
function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

test('a user who reloads between onboarding step 1 and step 2 can resume and complete their business profile without creating a duplicate workspace', async ({ page }) => {
  const email = uniqueEmail('resume');
  const password = 'password1234';

  await page.goto('/register');
  await page.getByLabel('Ad Soyad').fill('Resume Test User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Şifrə').fill(password);
  await page.getByRole('button', { name: 'Hesab yarat' }).click();

  await expect(page.getByText('İş sahənizi yaradın')).toBeVisible();
  await page.getByPlaceholder('Məsələn: Günel Beauty Studio').fill('Resume Test Business');
  await page.getByRole('button', { name: 'Davam et' }).click();
  await expect(page.getByText('Biznesinizi təsvir edin')).toBeVisible();

  // Simulate leaving mid-flow (browser close, crash, accidental refresh) —
  // navigate straight to the root instead of finishing step 2.
  await page.goto('/');

  // Real, honest empty state — never a fabricated "all set" dashboard.
  await expect(page.getByText('Biznes profili tapılmadı')).toBeVisible();
  const resumeLink = page.getByRole('link', { name: 'Biznesinizi təsvir edin' });
  await expect(resumeLink).toBeVisible();
  await resumeLink.click();

  // Must resume directly at step 2 — never re-show the workspace-name form,
  // which would create a second workspace on submit.
  await expect(page.getByText('Biznesinizi təsvir edin')).toBeVisible();
  await expect(page.getByPlaceholder('Məsələn: Günel Beauty Studio')).not.toBeVisible();

  await page.getByLabel('Biznes adı').fill('Resume Test Business');
  await page.getByLabel('Sahə').fill('Test sahəsi');
  await page.getByRole('button', { name: 'Bitir və davam et' }).click();

  await expect(page.getByRole('heading', { name: 'Aylıq Marketinq Planı Yaradın' })).toBeVisible();
  await page.getByRole('combobox').first().click();
  // Exactly one option in the OPEN listbox — proves no duplicate
  // workspace/profile was created by the resumed flow. Scoped to
  // `listbox` specifically because `getByRole('option')` unscoped also
  // matches the page's other static selects (e.g. the 3-item "objective"
  // dropdown), which isn't what this assertion is testing.
  const openListbox = page.getByRole('listbox');
  await expect(openListbox.getByRole('option')).toHaveCount(1);
  await expect(openListbox.getByRole('option', { name: 'Resume Test Business' })).toBeVisible();
});
