import 'server-only';
import type { ChatTarget } from '@/lib/chat';
import { getChatbotById, getOwnPlan } from '@/lib/chatbots';
import { ipHash } from '@/lib/client-key';
import { AppError } from '@/lib/errors';
import { PUBLIC_BOT_RATE_LIMIT, PUBLIC_RATE_LIMIT, PUBLIC_RATE_LIMIT_HOURLY } from '@/lib/rag-config';
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

  // Rate limits run before the plan lookup so a flood never reaches the profiles table.
  let visitorKey: string;
  try {
    visitorKey = `chat:${bot.id}:${ipHash(headers)}`;
  } catch (cause) {
    console.error('[chat-access] cannot build the rate limit key (is RATE_LIMIT_SALT set?)', { botId, cause: cause instanceof Error ? cause.message : 'unknown' });
    throw new AppError('PROVIDER_UNAVAILABLE', 'The assistant is temporarily unavailable. Please try again.');
  }
  const limits = [
    { key: visitorKey, ...PUBLIC_RATE_LIMIT },
    { key: `${visitorKey}:h`, ...PUBLIC_RATE_LIMIT_HOURLY },
    { key: `chat:${bot.id}`, ...PUBLIC_BOT_RATE_LIMIT },
  ];
  // Sequential on purpose: a visitor already blocked per minute or hour must not also consume the shared bot budget.
  for (const limit of limits) {
    const { data: isAllowed, error: limitError } = await admin.rpc('hit_rate_limit', {
      p_key: limit.key,
      p_window_seconds: limit.windowSeconds,
      p_max: limit.max,
    });
    if (limitError) {
      console.error('[chat-access] rate limit check failed', { botId, code: limitError.code });
      throw new AppError('PROVIDER_UNAVAILABLE', 'The assistant is temporarily unavailable. Please try again.');
    }
    if (!isAllowed) throw new AppError('RATE_LIMITED', 'Too many messages. Please wait a minute and try again.');
  }

  const plan = await getOwnPlan(admin, bot.owner_id);
  return { chatbotId: bot.id, ownerId: bot.owner_id, plan, mode: 'public' };
}
