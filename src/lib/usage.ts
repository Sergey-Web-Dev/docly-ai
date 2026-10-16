import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Used for reads only; writes compute the month in SQL so the client clock never decides.
export function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export async function reserveMessage(admin: SupabaseClient<Database>, ownerId: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc('reserve_message', { p_owner_id: ownerId, p_limit: limit });
  if (error) throw error;
  return data === true;
}

export async function refundMessage(admin: SupabaseClient<Database>, ownerId: string): Promise<void> {
  try {
    const { error } = await admin.rpc('refund_message', { p_owner_id: ownerId });
    if (error) console.error('[usage] refund failed', { code: error.code });
  } catch (error) {
    console.error('[usage] refund failed', { name: error instanceof Error ? error.name : 'unknown' });
  }
}

export async function getMonthlyUsage(supabase: SupabaseClient<Database>, ownerId: string): Promise<number> {
  const { data, error } = await supabase
    .from('usage_counters')
    .select('message_count')
    .eq('owner_id', ownerId)
    .eq('month', currentMonth())
    .maybeSingle();
  if (error) throw error;
  return data?.message_count ?? 0;
}
