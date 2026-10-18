import { expect, type Page } from '@playwright/test';
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
