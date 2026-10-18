import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embedQuery, generateAnswer } from '@/lib/ai';
import type { Database } from '@/lib/database.types';
import { AppError } from '@/lib/errors';
import type { Plan } from '@/lib/plans';
import { BLOCKED_ANSWER, buildPrompt, buildSystemInstruction, createNonce, isNotFoundAnswer, NOT_FOUND_ANSWER } from '@/lib/prompt';
import { CHAT_DEADLINE_MS, MATCH_COUNT, MIN_SIMILARITY } from '@/lib/rag-config';
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

type Outcome =
  | { readonly kind: 'no-match' }
  | { readonly kind: 'blocked'; readonly finishReason: string | undefined }
  | { readonly kind: 'answer'; readonly text: string; readonly finishReason: string | undefined };

export async function answerQuestion(admin: SupabaseClient<Database>, target: ChatTarget, question: string): Promise<ChatAnswer> {
  const deadline = Date.now() + CHAT_DEADLINE_MS;
  const limit = target.plan.messagesPerMonth;
  const isOwner = target.mode === 'owner';
  const logContext = { chatbotId: target.chatbotId, ownerId: target.ownerId };

  let month: string | null;
  try {
    month = await reserveMessage(admin, target.ownerId, limit);
  } catch (error) {
    console.error('[chat] reserve failed', { ...logContext, name: error instanceof Error ? error.name : 'unknown' });
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }
  if (!month) {
    throw new AppError(
      'QUOTA_EXCEEDED',
      isOwner ? `You've used all ${limit} messages this month on the ${target.plan.name} plan.` : PUBLIC_UNAVAILABLE,
      isOwner && target.plan.id === 'free',
    );
  }

  let outcome: Outcome;
  try {
    outcome = await retrieveAndGenerate(admin, target.chatbotId, question, deadline);
  } catch (error) {
    await refundMessage(admin, target.ownerId, month);
    if (error instanceof AppError) throw error;
    console.error('[chat] pipeline failed', { ...logContext, name: error instanceof Error ? error.name : 'unknown' });
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }

  console.info('[chat] answered', { ...logContext, status: outcome.kind, finishReason: outcome.kind === 'no-match' ? undefined : outcome.finishReason });
  // Nothing was generated (no evidence, or the provider refused): not counted.
  if (outcome.kind !== 'answer') await refundMessage(admin, target.ownerId, month);
  return {
    answer: outcome.kind === 'answer' ? outcome.text : outcome.kind === 'blocked' ? BLOCKED_ANSWER : NOT_FOUND_ANSWER,
    isGrounded: outcome.kind === 'answer' && !isNotFoundAnswer(outcome.text),
    usage: isOwner ? await readUsage(admin, target.ownerId, limit) : null,
  };
}

async function retrieveAndGenerate(admin: SupabaseClient<Database>, chatbotId: string, question: string, deadline: number): Promise<Outcome> {
  const vector = await embedQuery(question);
  const { data, error } = await admin.rpc('match_chunks', {
    p_chatbot_id: chatbotId,
    p_embedding: JSON.stringify(vector),
    p_match_count: MATCH_COUNT,
    p_min_similarity: MIN_SIMILARITY,
  });
  if (error) throw error;
  if (data.length === 0) return { kind: 'no-match' };
  const nonce = createNonce();
  const result = await generateAnswer({ systemInstruction: buildSystemInstruction(nonce), prompt: buildPrompt(question, data, nonce) }, deadline);
  return result.kind === 'blocked'
    ? { kind: 'blocked', finishReason: result.finishReason }
    : { kind: 'answer', text: result.text, finishReason: result.finishReason };
}

async function readUsage(admin: SupabaseClient<Database>, ownerId: string, limit: number): Promise<{ used: number; limit: number } | null> {
  try {
    return { used: await getMonthlyUsage(admin, ownerId), limit };
  } catch (error) {
    console.error('[chat] usage read failed', { name: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}
