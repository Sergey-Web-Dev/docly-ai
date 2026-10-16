import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const getOwnChatbot = vi.fn();
const getOwnPlan = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => Promise.resolve({ auth: { getUser } }) }));
vi.mock('@/lib/chatbots', () => ({
  getOwnChatbot: (...args: unknown[]) => getOwnChatbot(...args) as unknown,
  getOwnPlan: (...args: unknown[]) => getOwnPlan(...args) as unknown,
}));

import { resolveChatAccess } from '@/lib/chat-access';
import { PLANS } from '@/lib/plans';

describe('resolveChatAccess', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    getOwnChatbot.mockReset().mockResolvedValue({ id: 'bot-1' });
    getOwnPlan.mockReset().mockResolvedValue(PLANS.free);
  });

  it('should throw UNAUTHORIZED when there is no signed-in user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(resolveChatAccess('bot-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('should throw NOT_FOUND when the bot id belongs to someone else', async () => {
    await expect(resolveChatAccess('other-bot')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('should throw NOT_FOUND when the user has no bot', async () => {
    getOwnChatbot.mockResolvedValue(null);
    await expect(resolveChatAccess('bot-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('should return an owner target with the plan when the user owns the bot', async () => {
    await expect(resolveChatAccess('bot-1')).resolves.toEqual({ chatbotId: 'bot-1', ownerId: 'user-1', plan: PLANS.free, mode: 'owner' });
  });
});
