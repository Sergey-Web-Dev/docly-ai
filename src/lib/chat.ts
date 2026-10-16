import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embedQuery, generateAnswer } from '@/lib/ai';
import type { Database } from '@/lib/database.types';
import { AppError } from '@/lib/errors';
import type { Plan } from '@/lib/plans';
import { buildPrompt, NOT_FOUND_ANSWER, SYSTEM_INSTRUCTION } from '@/lib/prompt';
import { MATCH_COUNT, MIN_SIMILARITY } from '@/lib/rag-config';
import { getMonthlyUsage, refundMessage, reserveMessage } from '@/lib/usage';

export interface ChatTarget {
  readonly chatbotId: string;
  readonly ownerId: string;
  readonly plan: Plan;
  readonly mode: 'owner' | 'public';
}

export interface ChatAnswer {
  readonly answer: string;
  readonly isGrounded: boolean;
  readonly usage: { readonly used: number; readonly limit: number } | null; // null in public mode
}

const PROVIDER_ERROR = 'The AI service is unavailable right now. Please try again in a minute.';
const PUBLIC_UNAVAILABLE = 'This assistant is temporarily unavailable. Please try again later.';

export async function answerQuestion(admin: SupabaseClient<Database>, target: ChatTarget, question: string): Promise<ChatAnswer> {
  const limit = target.plan.messagesPerMonth;
  const isOwner = target.mode === 'owner';
  const reserved = await reserveMessage(admin, target.ownerId, limit);
  if (!reserved) {
    throw new AppError(
      'QUOTA_EXCEEDED',
      isOwner ? `You've used all ${limit} messages this month on the ${target.plan.name} plan.` : PUBLIC_UNAVAILABLE,
      isOwner && target.plan.id === 'free',
    );
  }

  let answer: string | null;
  try {
    answer = await retrieveAndGenerate(admin, target.chatbotId, question);
  } catch (error) {
    await refundMessage(admin, target.ownerId);
    if (error instanceof AppError) throw error;
    console.error('[chat] pipeline failed', { name: error instanceof Error ? error.name : 'unknown' });
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }

  if (answer === null) await refundMessage(admin, target.ownerId); // nothing generated, not counted
  return {
    answer: answer ?? NOT_FOUND_ANSWER,
    isGrounded: answer !== null && answer !== NOT_FOUND_ANSWER,
    usage: isOwner ? await readUsage(admin, target.ownerId, limit) : null,
  };
}

// Returns null when no evidence was found (generation is skipped).
async function retrieveAndGenerate(admin: SupabaseClient<Database>, chatbotId: string, question: string): Promise<string | null> {
  const vector = await embedQuery(question);
  const { data, error } = await admin.rpc('match_chunks', {
    p_chatbot_id: chatbotId,
    p_embedding: JSON.stringify(vector),
    p_match_count: MATCH_COUNT,
    p_min_similarity: MIN_SIMILARITY,
  });
  if (error) throw error;
  if (data.length === 0) return null;
  return generateAnswer({ systemInstruction: SYSTEM_INSTRUCTION, prompt: buildPrompt(question, data) });
}

async function readUsage(admin: SupabaseClient<Database>, ownerId: string, limit: number): Promise<{ used: number; limit: number } | null> {
  try {
    return { used: await getMonthlyUsage(admin, ownerId), limit };
  } catch (error) {
    console.error('[chat] usage read failed', { name: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}
