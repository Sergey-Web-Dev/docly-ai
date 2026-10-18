import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

vi.mock('server-only', () => ({}));

import { getChatbotById, getOwnPlan } from '@/lib/chatbots';
import { PLANS } from '@/lib/plans';

type Client = SupabaseClient<Database>;

function clientReturning(result: { data: unknown; error: unknown }): { client: Client; eq: ReturnType<typeof vi.fn> } {
  const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result) };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { client: { from: vi.fn().mockReturnValue(chain) } as unknown as Client, eq: chain.eq };
}

describe('getOwnPlan', () => {
  it('should return the plan stored on the profile', async () => {
    const { client } = clientReturning({ data: { plan: 'pro' }, error: null });
    await expect(getOwnPlan(client, 'u')).resolves.toEqual(PLANS.pro);
  });

  it('should throw instead of falling back to Free when the profile read fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = clientReturning({ data: null, error: { code: 'PGRST301', message: 'jwt' } });
    await expect(getOwnPlan(client, 'u')).rejects.toMatchObject({ code: 'PGRST301' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('getChatbotById', () => {
  it('should filter by the bot id', async () => {
    const { client, eq } = clientReturning({ data: { id: 'bot-1' }, error: null });
    await expect(getChatbotById(client, 'bot-1')).resolves.toEqual({ id: 'bot-1' });
    expect(eq).toHaveBeenCalledWith('id', 'bot-1');
  });

  it('should throw when the query fails', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'boom' } });
    await expect(getChatbotById(client, 'bot-1')).rejects.toBeDefined();
  });
});
