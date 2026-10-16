import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const getChatbotById = vi.fn();
const getOwnPlan = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const admin = { from: (...args: unknown[]) => from(...args) as unknown, rpc: (...args: unknown[]) => rpc(...args) as unknown };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => Promise.resolve({ auth: { getUser } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
vi.mock('@/lib/chatbots', () => ({
  getChatbotById: (...args: unknown[]) => getChatbotById(...args) as unknown,
  getOwnPlan: (...args: unknown[]) => getOwnPlan(...args) as unknown,
}));

import { resolveChatAccess } from '@/lib/chat-access';
import { PLANS } from '@/lib/plans';
import { PUBLIC_BOT_RATE_LIMIT, PUBLIC_RATE_LIMIT, PUBLIC_RATE_LIMIT_HOURLY } from '@/lib/rag-config';

const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
const publishedBot = { id: 'bot-1', owner_id: 'owner-1', is_published: true };

describe('resolveChatAccess', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_SALT', 'test-salt');
    vi.stubEnv('VERCEL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    getChatbotById.mockReset().mockResolvedValue({ id: 'bot-1', owner_id: 'user-1', is_published: false });
    getOwnPlan.mockReset().mockResolvedValue(PLANS.free);
    maybeSingle.mockReset().mockResolvedValue({ data: publishedBot, error: null });
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    eq.mockReset().mockReturnValue({ maybeSingle });
    select.mockReset().mockReturnValue({ eq });
    from.mockReset().mockReturnValue({ select });
  });

  describe('owner mode', () => {
    it('should look the bot up by the requested id', async () => {
      await resolveChatAccess('bot-1', headers);
      expect(getChatbotById).toHaveBeenCalledWith(expect.anything(), 'bot-1');
    });

    it('should return an owner target when the user owns an unpublished bot', async () => {
      await expect(resolveChatAccess('bot-1', headers)).resolves.toEqual({ chatbotId: 'bot-1', ownerId: 'user-1', plan: PLANS.free, mode: 'owner' });
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    });

    it('should propagate a plan lookup failure instead of defaulting to Free', async () => {
      getOwnPlan.mockRejectedValue(new Error('profiles down'));
      await expect(resolveChatAccess('bot-1', headers)).rejects.toThrow('profiles down');
    });
  });

  describe('public mode', () => {
    beforeEach(() => {
      getChatbotById.mockResolvedValue(null);
    });

    it('should use public access when signed out', async () => {
      getUser.mockResolvedValue({ data: { user: null } });
      getOwnPlan.mockResolvedValue(PLANS.pro);
      await expect(resolveChatAccess('bot-1', headers)).resolves.toEqual({ chatbotId: 'bot-1', ownerId: 'owner-1', plan: PLANS.pro, mode: 'public' });
      expect(getChatbotById).not.toHaveBeenCalled();
    });

    it('should use public access when a signed-in user does not own the bot', async () => {
      getChatbotById.mockResolvedValue(null);
      await expect(resolveChatAccess('bot-1', headers)).resolves.toMatchObject({ ownerId: 'owner-1', mode: 'public' });
    });

    it('should not treat a visible bot of someone else as owner mode', async () => {
      getChatbotById.mockResolvedValue({ id: 'bot-1', owner_id: 'someone-else' });
      await expect(resolveChatAccess('bot-1', headers)).resolves.toMatchObject({ mode: 'public', ownerId: 'owner-1' });
    });

    it('should read the plan of the bot owner, not of the visitor', async () => {
      await resolveChatAccess('bot-1', headers);
      expect(getOwnPlan).toHaveBeenCalledWith(admin, 'owner-1');
    });

    it('should throw BOT_UNAVAILABLE when the bot does not exist', async () => {
      maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE', status: 404 });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('should throw BOT_UNAVAILABLE when the bot is unpublished', async () => {
      maybeSingle.mockResolvedValue({ data: { ...publishedBot, is_published: false }, error: null });
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('should propagate a bot lookup error', async () => {
      maybeSingle.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'db down' } });
      await expect(resolveChatAccess('bot-1', headers)).rejects.toBeDefined();
    });

    it('should check the minute, hour and bot limits with the right keys and windows', async () => {
      await resolveChatAccess('bot-1', headers);
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(rpc).toHaveBeenNthCalledWith(1, 'hit_rate_limit', {
        p_key: expect.stringMatching(/^chat:bot-1:[0-9a-f]{32}$/) as unknown,
        p_window_seconds: PUBLIC_RATE_LIMIT.windowSeconds,
        p_max: PUBLIC_RATE_LIMIT.max,
      });
      expect(rpc).toHaveBeenNthCalledWith(2, 'hit_rate_limit', {
        p_key: expect.stringMatching(/^chat:bot-1:[0-9a-f]{32}:h$/) as unknown,
        p_window_seconds: PUBLIC_RATE_LIMIT_HOURLY.windowSeconds,
        p_max: PUBLIC_RATE_LIMIT_HOURLY.max,
      });
      expect(rpc).toHaveBeenNthCalledWith(3, 'hit_rate_limit', {
        p_key: 'chat:bot-1',
        p_window_seconds: PUBLIC_BOT_RATE_LIMIT.windowSeconds,
        p_max: PUBLIC_BOT_RATE_LIMIT.max,
      });
    });

    it.each([1, 2, 3])('should throw RATE_LIMITED when limit check %i denies the call', async (denied) => {
      let call = 0;
      rpc.mockImplementation(() => Promise.resolve({ data: ++call !== denied, error: null }));
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(getOwnPlan).not.toHaveBeenCalled();
    });

    it('should not consume the bot budget when the visitor is already limited', async () => {
      rpc.mockResolvedValue({ data: false, error: null });
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('should throw PROVIDER_UNAVAILABLE and log when RATE_LIMIT_SALT is missing', async () => {
      vi.stubEnv('RATE_LIMIT_SALT', '');
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_SALT'), expect.anything());
      expect(rpc).not.toHaveBeenCalled();
    });

    it('should throw PROVIDER_UNAVAILABLE when the limiter RPC fails', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
      await expect(resolveChatAccess('bot-1', headers)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
    });

    it('should read the owner plan only after the rate limits pass, and propagate its failure', async () => {
      getOwnPlan.mockRejectedValue(new Error('profiles down'));
      await expect(resolveChatAccess('bot-1', headers)).rejects.toThrow('profiles down');
      expect(rpc).toHaveBeenCalledTimes(3);
    });
  });
});
