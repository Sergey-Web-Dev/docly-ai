import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Used for reads only; writes compute the month in SQL so the client clock never decides.
export function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

// Returns the reserved UTC month ('YYYY-MM-01'), or null when the limit is reached.
// The same month must be passed to refundMessage so a refund never hits another month's row.
export async function reserveMessage(admin: SupabaseClient<Database>, ownerId: string, limit: number): Promise<string | null> {
  const { data, error } = await admin.rpc('reserve_message', { p_owner_id: ownerId, p_limit: limit });
  if (error) throw error;
  return data ?? null;
}

export async function refundMessage(admin: SupabaseClient<Database>, ownerId: string, month: string): Promise<void> {
  try {
    const { error } = await admin.rpc('refund_message', { p_owner_id: ownerId, p_month: month });
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
