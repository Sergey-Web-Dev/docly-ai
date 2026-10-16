import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveChatAccess = vi.fn();
const answerQuestion = vi.fn();
const admin = { tag: 'admin' };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/chat-access', () => ({ resolveChatAccess: (...args: unknown[]) => resolveChatAccess(...args) as unknown }));
vi.mock('@/lib/chat', () => ({ answerQuestion: (...args: unknown[]) => answerQuestion(...args) as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));

import { maxDuration, POST } from '@/app/api/chat/route';
import { AppError } from '@/lib/errors';

const BOT_ID = '8f14e45f-ceea-4a67-9b53-2f1a3c0d4e5a';
const target = { chatbotId: BOT_ID, ownerId: 'u', plan: {}, mode: 'owner' };

function post(body: string): Request {
  return new Request('http://localhost/api/chat', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
}

async function json(response: Response): Promise<{ error: { code: string; message: string; upgrade?: boolean } }> {
  return (await response.json()) as { error: { code: string; message: string; upgrade?: boolean } };
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    resolveChatAccess.mockReset().mockResolvedValue(target);
    answerQuestion.mockReset().mockResolvedValue({ answer: 'A', isGrounded: true, usage: { used: 1, limit: 30 } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('should keep the 30 s function duration', () => {
    expect(maxDuration).toBe(30);
  });

  it('should return the answer body and pass the admin client, target and message through', async () => {
    const response = await POST(post(JSON.stringify({ botId: BOT_ID, message: '  hi  ' })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ answer: 'A', isGrounded: true, usage: { used: 1, limit: 30 } });
    expect(resolveChatAccess).toHaveBeenCalledWith(BOT_ID);
    expect(answerQuestion).toHaveBeenCalledWith(admin, target, 'hi');
  });

  it.each([['malformed JSON', '{nope'], ['null body', 'null'], ['array body', '[]'], ['string body', '"x"'], ['empty body', '']])(
    'should return 400 "Invalid request." for %s',
    async (_name, body) => {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      await expect(json(response)).resolves.toEqual({ error: { code: 'VALIDATION', message: 'Invalid request.' } });
      expect(resolveChatAccess).not.toHaveBeenCalled();
    },
  );

  it('should return 400 with a validation message for a bad bot id or empty message', async () => {
    const badId = await POST(post(JSON.stringify({ botId: 'x', message: 'hi' })));
    expect(badId.status).toBe(400);
    expect((await json(badId)).error.message).toBe('Invalid request.');
    const empty = await POST(post(JSON.stringify({ botId: BOT_ID, message: '   ' })));
    expect(empty.status).toBe(400);
    expect((await json(empty)).error.message).toBe('Type a question first.');
    const missing = await POST(post(JSON.stringify({ botId: BOT_ID })));
    expect((await json(missing)).error.message).toBe('Type a question first.');
  });

  it('should map an AppError from access resolution to its status and body', async () => {
    resolveChatAccess.mockRejectedValue(new AppError('UNAUTHORIZED', 'Please sign in again.'));
    const response = await POST(post(JSON.stringify({ botId: BOT_ID, message: 'hi' })));
    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: { code: 'UNAUTHORIZED', message: 'Please sign in again.' } });
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('should map QUOTA_EXCEEDED with the upgrade flag to 402', async () => {
    answerQuestion.mockRejectedValue(new AppError('QUOTA_EXCEEDED', 'used up', true));
    const response = await POST(post(JSON.stringify({ botId: BOT_ID, message: 'hi' })));
    expect(response.status).toBe(402);
    await expect(json(response)).resolves.toEqual({ error: { code: 'QUOTA_EXCEEDED', message: 'used up', upgrade: true } });
  });

  it('should return a generic 500 without leaking details for an unknown error', async () => {
    answerQuestion.mockRejectedValue(new Error('secret db password leaked'));
    const response = await POST(post(JSON.stringify({ botId: BOT_ID, message: 'hi' })));
    expect(response.status).toBe(500);
    const body = await json(response);
    expect(body.error).toEqual({ code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
