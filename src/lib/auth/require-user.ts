import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';

export interface AuthedContext {
  readonly user: User;
  readonly supabase: SupabaseClient<Database>;
}

// Every dashboard page and every mutating server action MUST call requireUser(); the layout alone does not protect them.
export const requireUser = cache(async (): Promise<AuthedContext> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { user, supabase };
});
