import 'server-only';
import type { ChatTarget } from '@/lib/chat';
import { getOwnChatbot, getOwnPlan } from '@/lib/chatbots';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

// Epic 03: owner mode only. Epic 04 adds the public (published bot) branch here.
export async function resolveChatAccess(botId: string): Promise<ChatTarget> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in again.');
  const chatbot = await getOwnChatbot(supabase, user.id); // RLS
  if (!chatbot || chatbot.id !== botId) throw new AppError('NOT_FOUND', 'Bot not found.');
  return { chatbotId: chatbot.id, ownerId: user.id, plan: await getOwnPlan(supabase, user.id), mode: 'owner' };
}
