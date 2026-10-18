import { expect, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export async function signUpFresh(page: Page): Promise<string> {
  const email = `e2e-docs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

// Test-only admin access: loads the service key at runtime and never logs it.
export async function setMonthlyUsage(email: string, count: number): Promise<void> {
  process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase admin env is not configured.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let userId: string | undefined;
  for (let page = 1; !userId && page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((user) => user.email === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) throw new Error('E2E user not found.');

  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const { error } = await admin.from('usage_counters').upsert({ owner_id: userId, month, message_count: count });
  if (error) throw error;
}

export const DEMO_ONLY_ERROR = 'This is a demo checkout. Use a test card such as 4242 4242 4242 4242 — never enter a real card.';

// Distinctive values so a leak of the expiry or CVC into a request or a console message is easy to spot.
export const DISTINCT_EXPIRY = '11/34';
export const DISTINCT_CVC = '987';

export async function fillCard(page: Page, number: string): Promise<void> {
  await page.getByLabel('Card number').fill(number);
  await page.getByLabel('Expiry (MM/YY)').fill('1134');
  await page.getByLabel('CVC').fill(DISTINCT_CVC);
  await page.getByLabel('Name on card').fill('Test Customer');
}

// Records every outgoing request (method, URL and raw body, read byte-for-byte) and every console message.
// Used to prove that card digits never leave the browser or reach the console.
export function recordRequests(page: Page): { readonly all: string[]; readonly console: string[] } {
  const all: string[] = [];
  const consoleMessages: string[] = [];
  page.on('request', (request) => {
    all.push(`${request.method()} ${request.url()} ${request.postDataBuffer()?.toString('latin1') ?? ''}`);
  });
  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  return { all, console: consoleMessages };
}

export function expectNoCardDigits(requests: readonly string[], digits: readonly string[]): void {
  for (const entry of requests) {
    const compact = entry.replace(/[\s+-]|%20/g, '');
    for (const number of digits) expect(compact, `leaked a card ending ${number.slice(-4)}`).not.toContain(number);
  }
}

// Expiry and CVC are short, so they are matched as the exact strings a form post or a console line would carry.
export function expectNoExpiryOrCvc(entries: readonly string[]): void {
  for (const entry of entries) {
    expect(entry, 'leaked the expiry').not.toMatch(/11\s*(\/|%2F)\s*34|\b1134\b/i);
    expect(entry, 'leaked the CVC').not.toMatch(/\b987\b/);
  }
}

/** Resolves any CSS colour (rgb, lab, oklch, ...) of an element property to its [r, g, b, a] pixel via a 1x1 canvas. */
async function colorPixel(locator: Locator, property: 'backgroundColor' | 'color'): Promise<readonly number[]> {
  return locator.evaluate((element, prop) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.fillStyle = getComputedStyle(element)[prop];
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, property);
}

async function backgroundPixel(locator: Locator): Promise<readonly number[]> {
  return colorPixel(locator, 'backgroundColor');
}

const luminanceOf = ([r = 0, g = 0, b = 0]: readonly number[]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The space theme paints html dark; body must be transparent (or dark) so no white shows at the edges. */
export async function expectSpaceTheme(page: Page): Promise<void> {
  await expect(page.locator('.space-backdrop')).toHaveCount(1);
  expect(luminanceOf(await backgroundPixel(page.locator('html')))).toBeLessThan(40);
  const body = await backgroundPixel(page.locator('body'));
  expect(body[3] === 0 || luminanceOf(body) < 40).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
}

/** Light pages: no backdrop and an effectively white page background. */
export async function expectLightTheme(page: Page): Promise<void> {
  await expect(page.locator('.space-backdrop')).toHaveCount(0);
  expect(luminanceOf(await backgroundPixel(page.locator('body')))).toBeGreaterThan(230);
  // html is transparent here (the body background propagates to the canvas); it must not be dark.
  const html = await backgroundPixel(page.locator('html'));
  expect(html[3] === 0 || luminanceOf(html) > 230).toBe(true);
}

/** Dark-glass cards: translucent (the sky shows through) or dark, never an opaque light surface. */
export async function expectDarkGlassPricingCards(page: Page): Promise<void> {
  const cards = page.locator('ul > li > [data-slot="card"]');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const pixel = await backgroundPixel(card);
    expect(pixel[3] !== undefined && pixel[3] <= 128 ? true : luminanceOf(pixel) < 60, 'pricing card must not be an opaque light surface').toBe(true);
  }
}

export type SkyKind = 'space' | 'constellations' | 'galaxy';

/**
 * The three space formats: landing/auth sparkle sky (`space`), dashboard aurora + constellations (`constellations`)
 * and chat/widget galaxy (`galaxy`). All of them paint html dark on the server-rendered page.
 */
export async function expectSky(page: Page, kind: SkyKind): Promise<void> {
  await expectSpaceTheme(page);
  await expect(page.getByTestId('space-backdrop')).toHaveAttribute('data-variant', kind === 'constellations' ? 'aurora' : kind);
  await expect(page.getByTestId('starfield')).toHaveAttribute('data-variant', kind);
}

/** The text colour is light (readable on the dark sky). Resolved via canvas because Chrome reports lab()/oklch(). */
export async function expectLightText(locator: Locator): Promise<void> {
  expect(luminanceOf(await colorPixel(locator, 'color'))).toBeGreaterThan(180);
}
