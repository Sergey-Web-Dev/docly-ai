import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const getChatbotById = vi.fn();
const getOwnPlan = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => Promise.resolve({ auth: { getUser } }) }));
vi.mock('@/lib/chatbots', () => ({
  getChatbotById: (...args: unknown[]) => getChatbotById(...args) as unknown,
  getOwnPlan: (...args: unknown[]) => getOwnPlan(...args) as unknown,
}));

import { resolveChatAccess } from '@/lib/chat-access';
import { PLANS } from '@/lib/plans';

describe('resolveChatAccess', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    getChatbotById.mockReset().mockResolvedValue({ id: 'bot-1', owner_id: 'user-1' });
    getOwnPlan.mockReset().mockResolvedValue(PLANS.free);
  });

  it('should throw UNAUTHORIZED when there is no signed-in user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(resolveChatAccess('bot-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('should look the bot up by the requested id', async () => {
    await resolveChatAccess('bot-1');
    expect(getChatbotById).toHaveBeenCalledWith(expect.anything(), 'bot-1');
  });

  it('should reach the public-access stub (404) when the bot is not visible to the user', async () => {
    getChatbotById.mockResolvedValue(null);
    await expect(resolveChatAccess('other-bot')).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE', status: 404 });
  });

  it('should not use owner mode when a visible bot belongs to someone else', async () => {
    getChatbotById.mockResolvedValue({ id: 'bot-2', owner_id: 'someone-else' });
    await expect(resolveChatAccess('bot-2')).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
    expect(getOwnPlan).not.toHaveBeenCalled();
  });

  it('should return an owner target with the plan when the user owns the bot', async () => {
    await expect(resolveChatAccess('bot-1')).resolves.toEqual({ chatbotId: 'bot-1', ownerId: 'user-1', plan: PLANS.free, mode: 'owner' });
  });

  it('should propagate a plan lookup failure instead of defaulting to Free', async () => {
    getOwnPlan.mockRejectedValue(new Error('profiles down'));
    await expect(resolveChatAccess('bot-1')).rejects.toThrow('profiles down');
  });
});
