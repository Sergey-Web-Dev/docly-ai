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
import { BLOCKED_ANSWER, NOT_FOUND_ANSWER } from '@/lib/prompt';

interface Fake {
  readonly admin: SupabaseClient<Database>;
  readonly rpc: ReturnType<typeof vi.fn>;
  readonly docsFilters: [string, unknown][];
  readonly docsSelect: ReturnType<typeof vi.fn>;
}

interface MatchRow {
  readonly content: string;
  readonly document_id?: string;
  readonly similarity?: number;
}

const DOCS = [
  { id: 'doc-1', file_name: 'handbook.pdf' },
  { id: 'doc-2', file_name: 'faq.txt' },
];

function fakeAdmin(options: { reserve?: string | null; reserveError?: boolean; refundFails?: boolean; matches?: MatchRow[]; matchError?: boolean; usedCount?: number; docsError?: boolean }): Fake {
  const { reserve = '2026-10-01', reserveError = false, refundFails = false, matches = [], matchError = false, usedCount = 4, docsError = false } = options;
  const rows = matches.map((m, i) => ({ id: i + 1, document_id: 'doc-1', similarity: 0.8, ...m }));
  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_message') return Promise.resolve(reserveError ? { data: null, error: { message: 'db down' } } : { data: reserve, error: null });
    if (name === 'refund_message') return refundFails ? Promise.reject(new Error('refund down')) : Promise.resolve({ data: null, error: null });
    if (matchError) return Promise.resolve({ data: null, error: { message: 'db down' } });
    return Promise.resolve({ data: rows, error: null });
  });
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { message_count: usedCount }, error: null }) };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const docsFilters: [string, unknown][] = [];
  const docsResult = docsError ? { data: null, error: { message: 'db down' } } : { data: DOCS, error: null };
  const docsChain = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => (docsFilters.push([column, value]), docsChain)),
    in: vi.fn((column: string, value: unknown) => (docsFilters.push([column, value]), Promise.resolve(docsResult))),
  };
  docsChain.select.mockReturnValue(docsChain);
  const from = vi.fn((table: string) => (table === 'documents' ? docsChain : chain));
  const admin = { rpc, from } as unknown as SupabaseClient<Database>;
  return { admin, rpc, docsFilters, docsSelect: docsChain.select };
}

const ownerFree: ChatTarget = { chatbotId: 'bot-1', ownerId: 'owner-1', plan: PLANS.free, mode: 'owner' };
const vector = Array<number>(768).fill(0.1);

function callsTo(rpc: ReturnType<typeof vi.fn>, name: string): unknown[][] {
  return rpc.mock.calls.filter((call) => call[0] === name) as unknown[][];
}

describe('answerQuestion', () => {
  beforeEach(() => {
    embedQuery.mockReset().mockResolvedValue(vector);
    generateAnswer.mockReset().mockResolvedValue({ kind: 'answer', text: 'You get 20 days.', finishReason: 'STOP' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('should throw QUOTA_EXCEEDED with upgrade for a free owner and not embed when the quota is used up', async () => {
    const { admin } = fakeAdmin({ reserve: null });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      upgrade: true,
      message: "You've used all 30 messages this month on the Free plan.",
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('should not offer an upgrade when a pro owner runs out of messages', async () => {
    const { admin } = fakeAdmin({ reserve: null });
    const error = await answerQuestion(admin, { ...ownerFree, plan: PLANS.pro }, 'q').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', upgrade: false });
  });

  it('should use a neutral message and no upgrade in public mode when the quota is used up', async () => {
    const { admin } = fakeAdmin({ reserve: null });
    const error = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', upgrade: false, message: 'This assistant is temporarily unavailable. Please try again later.' });
  });

  it('should reserve with the plan limit', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }] });
    await answerQuestion(admin, { ...ownerFree, plan: PLANS.pro }, 'q');
    expect(callsTo(rpc, 'reserve_message')[0]?.[1]).toEqual({ p_owner_id: 'owner-1', p_limit: 300 });
  });

  it('should treat a not-found sentence with different case and whitespace as ungrounded', async () => {
    generateAnswer.mockResolvedValue({ kind: 'answer', text: `  ${NOT_FOUND_ANSWER.toUpperCase()}\n`, finishReason: 'STOP' });
    const { admin } = fakeAdmin({ matches: [{ content: 'c' }] });
    await expect(answerQuestion(admin, ownerFree, 'q')).resolves.toMatchObject({ isGrounded: false });
  });

  it('should refund the reserved month and return the fixed answer when the provider blocks the request', async () => {
    generateAnswer.mockResolvedValue({ kind: 'blocked', text: '', finishReason: 'SAFETY' });
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }], reserve: '2026-09-01' });
    const result = await answerQuestion(admin, ownerFree, 'q');
    expect(result).toMatchObject({ answer: BLOCKED_ANSWER, isGrounded: false });
    expect(BLOCKED_ANSWER).toBe("I can't help with that request.");
    expect(callsTo(rpc, 'refund_message')[0]?.[1]).toEqual({ p_owner_id: 'owner-1', p_month: '2026-09-01' });
  });

  it('should throw PROVIDER_UNAVAILABLE and not embed when the reserve rpc fails', async () => {
    const { admin } = fakeAdmin({ reserveError: true });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('should pass the same deadline-bearing second argument to generateAnswer, about 25 s ahead', async () => {
    const { admin } = fakeAdmin({ matches: [{ content: 'c' }] });
    const before = Date.now();
    await answerQuestion(admin, ownerFree, 'q');
    const deadline = generateAnswer.mock.calls[0]?.[1] as number;
    expect(deadline).toBeGreaterThanOrEqual(before + 25_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 25_000);
  });

  it('should build a per-request nonce into both the system instruction and the prompt', async () => {
    const { admin } = fakeAdmin({ matches: [{ content: 'c' }] });
    await answerQuestion(admin, ownerFree, 'q');
    await answerQuestion(admin, ownerFree, 'q');
    const calls = generateAnswer.mock.calls.map((call) => call[0] as { systemInstruction: string; prompt: string });
    const nonces = calls.map((input) => /<document-([0-9a-f]{8})>/.exec(input.systemInstruction)?.[1]);
    expect(nonces[0]).toBeDefined();
    expect(nonces[0]).not.toBe(nonces[1]);
    calls.forEach((input, index) => expect(input.prompt).toContain(`<document-${nonces[index]} index="1">`));
  });

  it('should rethrow the original error even when the refund itself fails', async () => {
    generateAnswer.mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE', 'try later'));
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'c' }], refundFails: true });
    await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: 'try later' });
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
  });

  it('should refund and return the not-found answer without generating when nothing matches', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [] });
    const result = await answerQuestion(admin, ownerFree, 'q');
    expect(result).toMatchObject({ answer: NOT_FOUND_ANSWER, isGrounded: false });
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
    expect(callsTo(rpc, 'refund_message')[0]?.[1]).toEqual({ p_owner_id: 'owner-1', p_month: '2026-10-01' });
  });

  it('should return the generated answer with the chunk text in the prompt and no refund when chunks match', async () => {
    const { admin, rpc } = fakeAdmin({ matches: [{ content: 'Vacation is 20 days.' }], usedCount: 5 });
    const result = await answerQuestion(admin, ownerFree, 'How many vacation days?');
    expect(result).toEqual({
      answer: 'You get 20 days.',
      isGrounded: true,
      usage: { used: 5, limit: 30 },
      sources: [{ documentId: 'doc-1', fileName: 'handbook.pdf' }],
    });
    expect((generateAnswer.mock.calls[0]?.[0] as { prompt: string }).prompt).toContain('Vacation is 20 days.');
    expect(callsTo(rpc, 'refund_message')).toHaveLength(0);
  });

  it('should return null usage in public mode', async () => {
    const { admin } = fakeAdmin({ matches: [{ content: 'c' }] });
    const result = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q');
    expect(result.usage).toBeNull();
  });

  it('should keep the count and mark the answer ungrounded when the model replies with the not-found sentence', async () => {
    generateAnswer.mockResolvedValue({ kind: 'answer', text: NOT_FOUND_ANSWER, finishReason: 'STOP' });
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

  describe('sources', () => {
    const twoDocs: MatchRow[] = [
      { content: 'Vacation is 20 days.', document_id: 'doc-1', similarity: 0.7 },
      { content: 'Remote work on Tuesday.', document_id: 'doc-2', similarity: 0.9 },
    ];

    it('should return the documents listed on the SOURCES line and strip the line in owner mode', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: 'Remote on Tuesday.\nSOURCES: 2', finishReason: 'STOP' });
      const { admin } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, ownerFree, 'q');
      expect(result.answer).toBe('Remote on Tuesday.');
      expect(result.sources).toEqual([{ documentId: 'doc-2', fileName: 'faq.txt' }]);
    });

    it('should list several documents in order of first use without duplicates', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: 'Both.\nSOURCES: 2, 1, 2', finishReason: 'STOP' });
      const { admin } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, ownerFree, 'q');
      expect(result.sources.map((s) => s.fileName)).toEqual(['faq.txt', 'handbook.pdf']);
    });

    it('should fall back to the most similar chunk document when the model gives no SOURCES line', async () => {
      const { admin } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, ownerFree, 'q');
      expect(result.sources).toEqual([{ documentId: 'doc-2', fileName: 'faq.txt' }]);
    });

    it('should return no sources in public mode and still strip the SOURCES line', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: 'Remote on Tuesday.\nSOURCES: 2', finishReason: 'STOP' });
      const { admin } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q');
      expect(result).toEqual({ answer: 'Remote on Tuesday.', isGrounded: true, usage: null, sources: [] });
      expect(JSON.stringify(result)).not.toContain('faq.txt');
    });

    it('should return no sources for a not-found answer, even with a SOURCES line', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: `${NOT_FOUND_ANSWER}\nSOURCES: 1`, finishReason: 'STOP' });
      const { admin } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, ownerFree, 'q');
      expect(result).toMatchObject({ answer: NOT_FOUND_ANSWER, isGrounded: false, sources: [] });
    });

    it('should return no sources when nothing matches and when the answer is blocked', async () => {
      const none = await answerQuestion(fakeAdmin({ matches: [] }).admin, ownerFree, 'q');
      expect(none.sources).toEqual([]);
      generateAnswer.mockResolvedValue({ kind: 'blocked', text: '', finishReason: 'SAFETY' });
      const blocked = await answerQuestion(fakeAdmin({ matches: twoDocs }).admin, ownerFree, 'q');
      expect(blocked.sources).toEqual([]);
    });

    it('should load file names only after generation, for the bot and the mapped documents, and keep them out of the prompt', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: 'Remote on Tuesday.\nSOURCES: 2', finishReason: 'STOP' });
      const { admin, docsFilters } = fakeAdmin({ matches: twoDocs });
      await answerQuestion(admin, ownerFree, 'q');
      expect(docsFilters).toEqual([['chatbot_id', 'bot-1'], ['id', ['doc-2']]]);
      const prompt = (generateAnswer.mock.calls[0]?.[0] as { prompt: string }).prompt;
      expect(prompt).not.toContain('source=');
      expect(prompt).not.toMatch(/handbook|faq/);
    });

    it('should never query documents.file_name and keep file names out of the prompt in public mode', async () => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text: 'Remote on Tuesday.\nSOURCES: 2', finishReason: 'STOP' });
      const { admin, docsSelect } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, { ...ownerFree, mode: 'public' }, 'q');
      expect(docsSelect).not.toHaveBeenCalled();
      const prompt = (generateAnswer.mock.calls[0]?.[0] as { prompt: string }).prompt;
      expect(prompt).not.toMatch(/source=|handbook|faq/);
      expect(JSON.stringify(result)).not.toMatch(/handbook|faq/);
    });

    it.each([[''], ['SOURCES: 1'], ['  \n']])('should treat an empty answer (%j) as no match: refund, not-found answer and no sources', async (text) => {
      generateAnswer.mockResolvedValue({ kind: 'answer', text, finishReason: 'STOP' });
      const { admin, rpc, docsSelect } = fakeAdmin({ matches: twoDocs });
      const result = await answerQuestion(admin, ownerFree, 'q');
      expect(result).toMatchObject({ answer: NOT_FOUND_ANSWER, isGrounded: false, sources: [] });
      expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
      expect(docsSelect).not.toHaveBeenCalled();
    });

    it('should refund and throw PROVIDER_UNAVAILABLE when the file name lookup fails', async () => {
      const { admin, rpc } = fakeAdmin({ matches: twoDocs, docsError: true });
      await expect(answerQuestion(admin, ownerFree, 'q')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(callsTo(rpc, 'refund_message')).toHaveLength(1);
    });
  });
});
