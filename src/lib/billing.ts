import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getOwnChatbot, getOwnPlan, listDocuments } from '@/lib/chatbots';
import type { Plan, PlanId } from '@/lib/plans';
import { getMonthlyUsage } from '@/lib/usage';

export interface UsageMeter {
  readonly used: number;
  readonly limit: number;
}

export interface BillingSummary {
  readonly plan: Plan;
  readonly documents: UsageMeter;
  readonly messages: UsageMeter;
  readonly isOverDocumentLimit: boolean;
}

export async function getBillingSummary(supabase: SupabaseClient<Database>, userId: string): Promise<BillingSummary> {
  const [plan, chatbot, messagesUsed] = await Promise.all([
    getOwnPlan(supabase, userId),
    getOwnChatbot(supabase, userId),
    getMonthlyUsage(supabase, userId),
  ]);
  const documentsUsed = chatbot ? (await listDocuments(supabase, chatbot.id)).length : 0;
  return {
    plan,
    documents: { used: documentsUsed, limit: plan.documents },
    messages: { used: messagesUsed, limit: plan.messagesPerMonth },
    isOverDocumentLimit: documentsUsed > plan.documents,
  };
}

// Demo billing: the plan is a plain column that only the server (admin client) may write. Nothing is ever deleted.
export async function changePlan(admin: SupabaseClient<Database>, userId: string, planId: PlanId): Promise<void> {
  const { data, error } = await admin.from('profiles').update({ plan: planId }).eq('id', userId).select('id');
  if (error) {
    console.error('[billing] plan change failed', { userId, code: error.code });
    throw error;
  }
  if (data.length === 0) throw new Error(`Profile not found for user ${userId}`);
}
