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

export async function listDocuments(supabase: SupabaseClient<Database>, chatbotId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*').eq('chatbot_id', chatbotId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOwnPlan(supabase: SupabaseClient<Database>, ownerId: string): Promise<Plan> {
  const { data } = await supabase.from('profiles').select('plan').eq('id', ownerId).single();
  return getPlan(data?.plan);
}
