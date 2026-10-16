import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const embedQuery = vi.fn();
const generateAnswer = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai', () => ({
  embedQuery: (...args: unknown[]) => embedQuery(...args) as unknown,
  generateAnswer: (...args: unknown[]) => generateAnswer(...args) as unknown,
}));

import { answerQuestion, type ChatTarget } from '@/lib/chat';
import { AppError } from '@/lib/errors';
import { PLANS } from '@/lib/plans';
import { NOT_FOUND_ANSWER } from '@/lib/prompt';

interface Fake {
  readonly admin: SupabaseClient<Database>;
  readonly rpc: ReturnType<typeof vi.fn>;
}

function fakeAdmin(options: { reserve?: boolean; matches?: { content: string }[]; matchError?: boolean; usedCount?: number }): Fake {
  const { reserve = true, matches = [], matchError = false, usedCount = 4 } = options;
  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_message') return Promise.resolve({ data: reserve, error: null });
    if (name === 'refund_message') return Promise.resolve({ data: null, error: null });
    if (matchError) return Promise.resolve({ data: null, error: { message: 'db down' } });
    return Promise.resolve({ data: matches, error: null });
  });
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { message_count: usedCount }, error: null }) };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const admin = { rpc, from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>;
  return { admin, rpc };
}

const ownerFree: ChatTarget = { chatbotId: 'bot-1', ownerId: 'owner-1', plan: PLANS.free, mode: 'owner' };
const vector = Array<number>(768).fill(0.1);

function callsTo(rpc: ReturnType<typeof vi.fn>, name: string): unknown[][] {
  return rpc.mock.calls.filter((call) => call[0] === name) as unknown[][];
}

describe('answerQuestion', () => {
  beforeEach(() => {
    embedQuery.mockReset().mockResolvedValue(vector);
    generateAnswer.mockReset().mockResolvedValue('You get 20 days.');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('should throw QUOTA_EXCEEDED with upgrade for a free owner and not embed when the quota is used up', async () => {
    const { admin } = fakeAdmin({ reserve: false });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      upgrade: true,
      message: "You've used all 30 messages this month on the Free plan.",
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('should not offer an upgrade when a pro owner runs out of messages', async () => {
    const { admin } = fakeAdmin({ reserve: false });
    const error = await answerQuestion(admin, { ...ownerFree, plan: PLANS.pro }, 'q').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', upgrade: false });
  });

  it('should use a neutral message and no upgrade in public mode when the quota is used up', async () => {
    const { admin } = fakeAdmin({ reserve: false });
    const error = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', upgrade: false, message: 'This assistant is temporarily unavailable. Please try again later.' });
  });

  it('should reserve with the plan limit', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    await answerQuestion(admin, { ...ownerFree, plan: PLANS.pro }, 'q');
    expect(callsTo(rpc, 'reserve_message')[0]?.[1]).toEqual({ p_owner_id: 'owner-1', p_limit: 300 });
  });

  it('should refund and return the not-found answer without generating when nothing matches', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [] });
    const result = await answerQuestion(admin, ownerFree, 'q');
    expect(result).toMatchObject({ answer: NOT_FOUND_ANSWER, isGrounded: false });
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
  });

  it('should return the generated answer with the chunk text in the prompt and no refund when chunks match', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'Vacation is 20 days.' }], usedCount: 5 });
    const result = await answerQuestion(admin, ownerFree, 'How many vacation days?');
    expect(result).toEqual({ answer: 'You get 20 days.', isGrounded: true, usage: { used: 5, limit: 30 } });
    expect((generateAnswer.mock.calls[0]?.[0] as { prompt: string }).prompt).toContain('Vacation is 20 days.');
    expect(callsTo(rpc, 'refund_message')).toHaveLength(0);
  });

  it('should return null usage in public mode', async () => {
    const { admin } = fakeAdmin({ matches: [{ content: 'c' }] });
    const result = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q');
    expect(result.usage).toBeNull();
  });

  it('should keep the count and mark the answer ungrounded when the model replies with the not-found sentence', async () => {
    generateAnswer.mockResolvedValue(NOT_FOUND_ANSWER);
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    const result = await answerQuestion(admin, ownerFree, 'q');
    expect(result).toMatchObject({ answer: NOT_FOUND_ANSWER, isGrounded: false });
    expect(callsTo(rpc, 'refund_message')).toHaveLength(0);
  });

  it('should refund and throw PROVIDER_UNAVAILABLE when embedding fails', async () => {
    embedQuery.mockRejectedValue(new Error('boom'));
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
  });

  it('should refund and rethrow the AppError when generation fails', async () => {
    generateAnswer.mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE', 'try later'));
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: 'try later' });
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
  });

  it('should refund when the retrieval query fails', async () => {
    const { admin, rpc } = fakeAdmin({ matchError: true });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
  });

  it('should search only the target bot with the serialized vector', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    await answerQuestion(admin, ownerFree, 'q');
    expect(callsTo(rpc, 'match_chunks')[0]?.[1]).toEqual({
      p_chatbot_id: 'bot-1',
      p_embedding: JSON.stringify(vector),
      p_match_count: 5,
      p_min_similarity: 0.55,
    });
  });
});
