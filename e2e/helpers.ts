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
