import 'server-only';
import type { ChatTarget } from '@/lib/chat';
import { getChatbotById, getOwnPlan } from '@/lib/chatbots';
import { rateLimitKey } from '@/lib/client-key';
import { AppError } from '@/lib/errors';
import { PUBLIC_RATE_LIMIT } from '@/lib/rag-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Owner mode: the signed-in user owns the bot (looked up by id through RLS), so ownerId/plan come from the session.
// Anything else (signed-out visitors and signed-in non-owners alike) goes to resolvePublicAccess.
export async function resolveChatAccess(botId: string, headers: Headers): Promise<ChatTarget> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const chatbot = await getChatbotById(supabase, botId);
    if (chatbot && chatbot.owner_id === user.id) {
      return { chatbotId: chatbot.id, ownerId: user.id, plan: await getOwnPlan(supabase, user.id), mode: 'owner' };
    }
  }
  return resolvePublicAccess(botId, headers);
}

// Public mode: the visitor is not the owner, so ownerId and plan come from the bot row and the owner's profile
// (read with the ADMIN client, never from the session). Unknown or unpublished bots throw BOT_UNAVAILABLE.
async function resolvePublicAccess(botId: string, headers: Headers): Promise<ChatTarget> {
  const admin = createAdminClient();
  const { data: bot, error } = await admin.from('chatbots').select('id, owner_id, is_published').eq('id', botId).maybeSingle();
  if (error) {
    console.error('[chat-access] bot lookup failed', { botId, code: error.code });
    throw error;
  }
  if (!bot?.is_published) throw new AppError('BOT_UNAVAILABLE', 'This assistant is unavailable.');

  const plan = await getOwnPlan(admin, bot.owner_id);

  const { data: isAllowed, error: limitError } = await admin.rpc('hit_rate_limit', {
    p_key: rateLimitKey(headers, bot.id),
    p_window_seconds: PUBLIC_RATE_LIMIT.windowSeconds,
    p_max: PUBLIC_RATE_LIMIT.max,
  });
  if (limitError) {
    console.error('[chat-access] rate limit check failed', { botId, code: limitError.code });
    throw new AppError('PROVIDER_UNAVAILABLE', 'The assistant is temporarily unavailable. Please try again.');
  }
  if (!isAllowed) throw new AppError('RATE_LIMITED', 'Too many messages. Please wait a minute and try again.');

  return { chatbotId: bot.id, ownerId: bot.owner_id, plan, mode: 'public' };
}
