import { expect, test } from '@playwright/test';
import { expectDarkGlassPricingCards, expectLightText, expectSky, expectSpaceTheme } from './helpers';

test('owner signs up, stays signed in after refresh, signs out', async ({ page }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
  await expect(page.getByText('Create your bot')).toBeVisible();
  // Client-side navigation away from /signup: the dashboard gets its own format (aurora + constellations), not the landing sparkle sky.
  await expectSky(page, 'constellations');
  await expectLightText(page.getByRole('heading', { name: 'Create your bot' }));

  await page.goto('/dashboard/billing');
  await expectSky(page, 'constellations');
  await expectDarkGlassPricingCards(page);
  await page.goto('/dashboard');

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
});

test('unauthenticated visitor is redirected from dashboard to login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows an inline error and keeps the email', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('WrongPass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByLabel('Email')).toHaveValue('nobody@example.com');
});

for (const path of ['/login', '/signup']) {
  test(`${path} renders the space backdrop with a dark html and body background`, async ({ page }) => {
    await page.goto(path);
    await expectSpaceTheme(page);
  });
}
