import 'server-only';
import type { ChatTarget } from '@/lib/chat';
import { getChatbotById, getOwnPlan } from '@/lib/chatbots';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

// Owner mode: the signed-in user owns the bot (looked up by id through RLS), so ownerId/plan come from the session.
// Anything else goes to resolvePublicAccess.
// TODO(Epic 04): signed-out visitors should also reach resolvePublicAccess instead of UNAUTHORIZED.
export async function resolveChatAccess(botId: string): Promise<ChatTarget> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in again.');
  const chatbot = await getChatbotById(supabase, botId);
  if (chatbot && chatbot.owner_id === user.id) {
    return { chatbotId: chatbot.id, ownerId: user.id, plan: await getOwnPlan(supabase, user.id), mode: 'owner' };
  }
  return resolvePublicAccess(botId);
}

// Contract for Epic 04 (public mode): the visitor is not the owner, so ownerId and plan MUST NOT come from the session.
// Read the bot row (must exist and be published) and the owner's profile.plan with the ADMIN client, return
// { chatbotId, ownerId: bot.owner_id, plan: getPlan(profile.plan), mode: 'public' }, and apply the rate limit here.
// Unknown or unpublished bots throw BOT_UNAVAILABLE.
function resolvePublicAccess(botId: string): Promise<ChatTarget> {
  void botId;
  // TODO(Epic 04): implement published-bot lookup + rate limit.
  return Promise.reject(new AppError('BOT_UNAVAILABLE', 'This assistant is unavailable.'));
}
