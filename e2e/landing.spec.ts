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
