import { expect, test } from '@playwright/test';

test('landing explains the product, shows pricing and links to sign-up', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your docs. Instant answers.');
  const pricing = page.locator('#pricing');
  await expect(pricing).toContainText('30');
  await expect(pricing).toContainText('300');
  await expect(pricing).toContainText('$19');
  await expect(pricing.getByRole('link', { name: 'Choose Free' })).toHaveAttribute('href', '/signup');
  await expect(pricing.getByRole('link', { name: 'Choose Pro' })).toHaveAttribute('href', '/signup');
  await page.getByRole('main').getByRole('link', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('header "Get started" link leads to sign-up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('landing has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});

test('landing renders the animated star field canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('starfield')).toHaveCount(1);
  await expect(page.getByTestId('starfield')).toHaveAttribute('aria-hidden', 'true');
});

test('chat preview animation starts typing the first question', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('chat-preview')).toContainText('How many vacation', { timeout: 5_000 });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('chat preview shows the first exchange statically', async ({ page }) => {
    await page.goto('/');
    const preview = page.getByTestId('chat-preview');
    await expect(preview).toContainText('How many vacation days do new hires get?');
    await expect(preview).toContainText('New hires get 20 vacation days in their first year, per the employee handbook.');
  });
});

// Rendering the embed page needs the full app env (Supabase secret): validated in the main checkout.
test('embed page has no star field canvas', async ({ page }) => {
  await page.goto('/embed/00000000-0000-4000-8000-000000000000');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByTestId('starfield')).toHaveCount(0);
});
