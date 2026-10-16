import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for integration tests`);
  return value;
}

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  readonly id: string;
  readonly client: SupabaseClient<Database>;
}

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}@example.com`;
  const password = 'Password123!';
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const client = createClient<Database>(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}
