import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/lib/database.types';
import { getPlan, type Plan } from '@/lib/plans';

export type Chatbot = Tables<'chatbots'>;
export type DocumentRow = Tables<'documents'>;

export async function getOwnChatbot(supabase: SupabaseClient<Database>, ownerId: string): Promise<Chatbot | null> {
  const { data, error } = await supabase.from('chatbots').select('*').eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  return data;
}

// Goes through the caller's RLS: returns the bot only if the session user may see it.
export async function getChatbotById(supabase: SupabaseClient<Database>, botId: string): Promise<Chatbot | null> {
  const { data, error } = await supabase.from('chatbots').select('*').eq('id', botId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDocuments(supabase: SupabaseClient<Database>, chatbotId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*').eq('chatbot_id', chatbotId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOwnPlan(supabase: SupabaseClient<Database>, ownerId: string): Promise<Plan> {
  const { data, error } = await supabase.from('profiles').select('plan').eq('id', ownerId).single();
  if (error) {
    // Never fall back to Free silently: a profile read failure must not change the user's quota.
    console.error('[chatbots] plan lookup failed', { ownerId, code: error.code });
    throw error;
  }
  return getPlan(data.plan);
}
