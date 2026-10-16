// ONLY call after the caller's access was verified on the server
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env-server';

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
